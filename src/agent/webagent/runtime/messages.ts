/**
 * Message assembly + LLM streaming.
 *
 * `buildMessages` is the pure function that turns the live session into
 * `LLMMessage[]` — system prompt + capped history walk + env block + DOM
 * dump + optional screenshots.
 *
 * `callLlmStream` wraps the provider's streamComplete (or falls back to
 * complete()) into a unified iterable yielding text-delta / tool-call
 * events, applies the per-call timeout, and emits an `LlmCallInfo` to
 * the orchestrator's listener for analytics.
 */

import type { WebAgent } from '../webagent';
import type {
  CompleteResult,
  LLMMessage,
  ToolCall,
} from '../../llm/types';
import type { StreamingProvider, StreamChunk } from '../../llm/stream';
import type { AgentTurn } from '../types';
import type { ScreenshotConfig } from '../screenshot';
import { resolveLLM } from '../../llm/router';
import { lastUserTurn } from '../session';
import {
  assembleSystemPrompt,
  renderSitemap,
  renderSelectionBlock,
  renderPageStateBlock,
  renderUserReminder,
} from '../prompt';
import { readDOM } from '../dom-reader';
import { captureScreenshots } from '../screenshot';
import { AGENT_TURN_TOOL, renderToolReference } from '../cot';
import {
  CHARS_PER_TOKEN,
  composeSignals,
  estimateTurnChars,
  messageContentHasImage,
} from './helpers';
import { recordMessages } from './debug';

export async function buildMessages(agent: WebAgent): Promise<LLMMessage[]> {
  const session = agent.sessionRef;
  if (!session) return [];

  const domResult = readDOM({
    filter: agent.configRef.domFilter,
    maxLength: agent.configRef.domMaxLength,
  });
  // Consult the registered DOM provider for the prompt
  // text portion. The runtime KEEPS using readDOM for the indexMap
  // (selector resolution at action-dispatch needs that map); only
  // the LLM-visible string is swappable. Hosts who registered a
  // custom `dom` provider get their text in the prompt; default
  // installs `defaultDomProvider` which just re-wraps readDOM, so
  // un-overridden behaviour is byte-identical to v0.1.
  const domProvider = agent.contextProviders.get('dom');
  const ctxReq = { signal: agent.abortSignalRef ?? new AbortController().signal };
  let domText = domResult.text;
  if (domProvider) {
    try {
      const override = await domProvider(ctxReq);
      if (typeof override === 'string') domText = override;
    } catch { /* fall back to readDOM text */ }
  }
  // Append optional slots from the provider registry. Each is
  // additive — when the provider returns a non-empty string we
  // tack it on after the DOM text. Default providers return null
  // when their source isn't available (no selection, no history,
  // SSR contexts) so absent data doesn't pollute the prompt.
  const extraSlots: string[] = [];
  for (const role of ['url', 'page_summary', 'history', 'selection'] as const) {
    const fn = agent.contextProviders.get(role);
    if (!fn) continue;
    try {
      const out = await fn(ctxReq);
      if (typeof out === 'string' && out.length > 0) extraSlots.push(out);
    } catch { /* skip slot */ }
  }
  const pageContext = extraSlots.length > 0
    ? domText + '\n\n' + extraSlots.join('\n\n')
    : domText;
  agent.currentIndexMap = domResult.indexMap;

  // Screenshot slot — runs through the provider registry too.
  // Default `defaultScreenshotProvider` calls `captureScreenshots`,
  // matching the existing behaviour. Hosts overriding the slot get
  // their custom rasterizer; the legacy `agent.configRef.screenshot`
  // config gates whether we ask the provider at all (so hosts who
  // opted out keep paying zero cost).
  let screenshotImages: string[] = [];
  if (agent.configRef.screenshot) {
    const ssProvider = agent.contextProviders.get('screenshot');
    if (ssProvider) {
      try {
        const dataUrl = await ssProvider(ctxReq);
        if (typeof dataUrl === 'string' && dataUrl.length > 0) {
          screenshotImages = [dataUrl];
        }
      } catch { screenshotImages = []; }
    } else {
      // Defensive — constructor installs the default, but if a host
      // explicitly unregistered the slot we fall back to the raw
      // captureScreenshots path so the prompt still gets an image.
      const sCfg: ScreenshotConfig = agent.configRef.screenshot === true
        ? { mode: 'viewport' }
        : agent.configRef.screenshot;
      try {
        screenshotImages = await captureScreenshots(sCfg);
      } catch {
        screenshotImages = [];
      }
    }
  }

  const toolReference = agent.configRef.cotMode
    ? renderToolReference(agent.buildCotToolRefs())
    : undefined;

  const systemPrompt = assembleSystemPrompt({
    locale: agent.configRef.locale,
    agentName: agent.configRef.agentName,
    siteName: agent.configRef.siteName,
    systemPrompt: agent.configRef.systemPrompt,
    brand: agent.configRef.brand,
    persona: agent.configRef.persona,
    appendSystemPrompt: agent.configRef.appendSystemPrompt,
    sitemap: agent.configRef.sitemap,
    session,
    pageContext,
    selection: agent.currentSelectionRef ?? undefined,
    previousUrl: undefined,
    cotMode: agent.configRef.cotMode,
    toolReference,
  });

  const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }];

  // History capping. Two orthogonal limits:
  //   - `maxTurnsInPrompt`: count-based slice (cheap, predictable)
  //   - `maxPromptTokens` : token-budget walk from newest backward
  // Both default to off. Count-cap runs first then token-cap.
  // Leading non-user turns are stripped — LLM APIs reject conversations
  // that start with an orphan assistant/tool right after the system prompt.
  let turnsToSerialize: AgentTurn[] = session.turns;
  const turnLimit = agent.configRef.maxTurnsInPrompt;
  if (turnLimit && turnLimit > 0 && turnsToSerialize.length > turnLimit) {
    turnsToSerialize = turnsToSerialize.slice(-turnLimit);
  }
  const tokenLimit = agent.configRef.maxPromptTokens;
  if (tokenLimit && tokenLimit > 0 && turnsToSerialize.length > 0) {
    const baseReserve = 3000;
    let budgetChars = (tokenLimit - baseReserve) * CHARS_PER_TOKEN;
    const kept: AgentTurn[] = [];
    for (let i = turnsToSerialize.length - 1; i >= 0; i--) {
      const t = turnsToSerialize[i]!;
      const c = estimateTurnChars(t);
      if (budgetChars - c < 0 && kept.length > 0) break;
      kept.unshift(t);
      budgetChars -= c;
    }
    turnsToSerialize = kept;
  }
  const firstUserIdx = turnsToSerialize.findIndex((t) => t.kind === 'user');
  if (firstUserIdx > 0) {
    turnsToSerialize = turnsToSerialize.slice(firstUserIdx);
  }

  for (const turn of turnsToSerialize) {
    if (turn.kind === 'user') {
      const parts: string[] = [turn.text];
      if (turn.selection) parts.push(renderSelectionBlock(turn.selection));
      const images = turn.selection?.images ?? [];
      if (images.length > 0) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: parts.join('\n\n') },
            ...images.map((img: string) => ({ type: 'image' as const, image: img })),
          ],
        });
      } else {
        messages.push({ role: 'user', content: parts.join('\n\n') });
      }
    } else if (turn.kind === 'agent_step') {
      messages.push({
        role: 'assistant',
        content: turn.preText ?? '',
        toolCalls: [{
          id: turn.toolCallId,
          name: turn.toolCall.name,
          arguments: turn.toolCall.arguments,
        }],
      });
      messages.push({
        role: 'tool',
        toolCallId: turn.toolCallId,
        name: turn.toolCall.name,
        content: JSON.stringify(turn.result),
      });
    } else if (turn.kind === 'agent_final') {
      messages.push({ role: 'assistant', content: turn.text });
    }
  }

  // Env block: current page state + fresh DOM dump. In classic mode the
  // legacy reminder + sitemap also ride along; in CoT mode both live on
  // the system prompt and env stays minimal.
  const envParts: string[] = [];
  if (!agent.configRef.cotMode) {
    if (agent.configRef.sitemap) envParts.push(renderSitemap(agent.configRef.sitemap));
    const latestUser = lastUserTurn(session);
    envParts.push(renderUserReminder({
      latestUserText: latestUser?.text ?? '',
      stepsSoFar: session.turns,
      currentUrl: session.currentPage,
      cotMode: false,
    }));
  }
  envParts.push(renderPageStateBlock({
    currentPage: session.currentPage,
    pageContext,
    plan: session.plan,
  }));
  const envText = envParts.join('\n\n');
  if (screenshotImages.length > 0) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: envText },
        ...screenshotImages.map((img) => ({ type: 'image' as const, image: img })),
      ],
    });
  } else {
    messages.push({ role: 'user', content: envText });
  }

  recordMessages(messages);
  return messages;
}

export async function* callLlmStream(
  agent: WebAgent,
  signal: AbortSignal,
): AsyncIterable<
  | { kind: 'text-delta'; delta: string }
  | { kind: 'tool-call'; call: ToolCall }
  /**
   * v0.2.0 streaming-envelope: forwards each fragment of a tool call's
   * arguments AS the provider streams them. cotLoop consumes these to
   * feed `StreamingEnvelopeParser`, so narrate text appears in the
   * subtitle bar as the LLM types it instead of after parse completes.
   * Only OpenAI-compatible providers emit this today.
   */
  | { kind: 'tool-args-delta'; id: string; name: string; deltaText: string; accumulatedText: string }
> {
  if (!agent.sessionRef) return;

  const messages = await buildMessages(agent);
  // Vision routing: any image content part → 'vision' role. Router
  // fallback inside resolveLLM handles vision → webagent if vision is
  // unconfigured.
  const hasImages = agent.configRef.screenshot != null && agent.configRef.screenshot !== false
    ? true
    : messageContentHasImage(messages);
  const role = hasImages ? 'vision' as const : 'webagent' as const;
  const llm = resolveLLM(agent.configRef.llm, role);
  const tools = agent.buildToolDefinitions();
  const completeOpts = {
    messages,
    tools,
    signal,
    thinking: agent.configRef.thinking ?? 'off' as const,
    // CoT mode forces the model to call the single wrapping tool every
    // turn — without this, smaller models occasionally emit a free-text
    // turn with no actions to dispatch.
    toolChoice: agent.configRef.cotMode
      ? ({ name: AGENT_TURN_TOOL } as const)
      : undefined,
  };

  const streamProvider = llm as unknown as StreamingProvider;
  const hasStreaming = typeof streamProvider.streamComplete === 'function';

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort('llm timeout'), agent.configRef.llmTimeoutMs);
  const composedSignal = composeSignals(signal, timeoutCtrl.signal);

  // Per-call perf instrumentation. Consumer-side measurement so it
  // reflects what the agent actually saw.
  const startedAt = Date.now();
  let firstDeltaAt: number | undefined;
  let usage: { promptTokens: number; completionTokens: number } | undefined;
  const modelId = (llm as { name?: string; model?: string }).model
    ?? (llm as { name?: string }).name;

  try {
    if (hasStreaming) {
      const handle = streamProvider.streamComplete!({ ...completeOpts, signal: composedSignal });
      let lastText = '';
      const yieldedToolIds = new Set<string>();
      for await (const chunk of handle as AsyncIterable<StreamChunk>) {
        if (chunk.text.length > lastText.length) {
          const newDelta = chunk.text.slice(lastText.length);
          lastText = chunk.text;
          if (newDelta) {
            if (firstDeltaAt === undefined) firstDeltaAt = Date.now();
            yield { kind: 'text-delta', delta: newDelta };
          }
        }
        // v0.2.0 — forward per-fragment tool-args deltas so the cot
        // loop can feed StreamingEnvelopeParser. We count this toward
        // TTFT too: the user perceives "agent started" the moment narrate
        // text begins streaming, even though no plain text-delta arrived.
        if (chunk.toolArgsDelta) {
          if (firstDeltaAt === undefined) firstDeltaAt = Date.now();
          yield {
            kind: 'tool-args-delta',
            id: chunk.toolArgsDelta.id,
            name: chunk.toolArgsDelta.name,
            deltaText: chunk.toolArgsDelta.deltaText,
            accumulatedText: chunk.toolArgsDelta.accumulatedText,
          };
        }
        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            if (yieldedToolIds.has(tc.id)) continue;
            if (!tc.name) continue;
            yieldedToolIds.add(tc.id);
            yield { kind: 'tool-call', call: tc };
          }
        }
        if (chunk.error) throw chunk.error;
      }
      try {
        const final = await (handle as unknown as Promise<CompleteResult>);
        usage = final.usage;
      } catch { /* error already surfaced via chunk.error */ }
    } else {
      const result = await llm.complete({ ...completeOpts, signal: composedSignal });
      if (result.content) {
        if (firstDeltaAt === undefined) firstDeltaAt = Date.now();
        yield { kind: 'text-delta', delta: result.content };
      }
      if (result.toolCalls) {
        for (const tc of result.toolCalls) yield { kind: 'tool-call', call: tc };
      }
      usage = result.usage;
    }
  } finally {
    clearTimeout(timer);
    const endedAt = Date.now();
    if (agent.llmCallListenerRef && firstDeltaAt !== undefined) {
      const ttftMs = firstDeltaAt - startedAt;
      const durationMs = endedAt - startedAt;
      try {
        agent.llmCallListenerRef({
          role,
          ttftMs,
          durationMs,
          outputTokens: usage?.completionTokens,
          inputTokens: usage?.promptTokens,
          model: modelId,
        });
      } catch { /* listener errors must never break the agent loop */ }
    }
  }
}
