/**
 * The two top-level loops: classic single-tool and CoT envelope.
 *
 * Both consume the WebAgent instance through its `@internal` surface
 * (sessionRef / configRef / actionsRef / ...) so the main class file
 * stays focused on constructor + public API + state.
 */

import type { WebAgent } from '../webagent';
import type { AgentEvent, ActionResult } from '../types';
import type { ToolCall } from '../../llm/types';
import {
  pushAgentStep,
  pushAgentFinal,
  lastUserTurn,
} from '../session';
import { executeAction } from '../execute-action';
import {
  AGENT_TURN_TOOL,
  parseTurnResponse,
  isNarrateAction,
  isToolAction,
} from '../cot';
import { sdkString } from '../../../utils/sdk-i18n';
import {
  awaitNavSettle,
  extractTargetSelector,
  isUserEditingInPalette,
  narrateAction,
  sleep,
} from './helpers';
import { recordParseFail, recordTurn } from './debug';
import { callLlmStream } from './messages';
import type { EnvelopeStreamEvent } from './streaming-envelope';

/**
 * Per-turn mutable dispatch state. The cot loop uses one of these and
 * both the streaming dispatch path AND the JSON-parse fallback path
 * thread the same instance through `dispatchOneAction` so flags +
 * results aggregate identically.
 */
interface DispatchState {
  actionResults: Array<
    | { type: 'narrate'; text: string }
    | { type: 'tool'; name: string; ok: boolean; reason?: string; data?: unknown }
    | { type: 'done' }
  >;
  pageChanged: boolean;
  endLoopRequested: boolean;
  executedReactionRequiringTool: boolean;
  actionErrorThisTurn: number;
}

const TOOLS_REQUIRING_NEXT_REACTION_SET = new Set(['ask_user', 'ask_user_choice', 'navigate']);

/**
 * Look for a visible <a href> whose target matches `path`. Used by the
 * `preferClickLinkOverNavigate` config flag — when the host opts in we
 * trigger this anchor's `.click()` instead of calling the navigate bridge
 * directly, so demos look like a real human clicking nav.
 *
 * Matches an anchor when either:
 *   - href equals path exactly (`/dashboard`)
 *   - href equals path with trailing slash trimmed
 *   - the anchor's `pathname` matches path (handles fully-qualified hrefs)
 *
 * Skips disabled / `aria-disabled` / hidden anchors. Returns the first
 * match in document order — usually the primary nav link.
 */
function findNavLink(path: string): HTMLAnchorElement | null {
  if (typeof document === 'undefined' || !path) return null;
  const want = path.replace(/\/$/, '') || '/';
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
  for (const a of Array.from(anchors)) {
    if (a.getAttribute('aria-disabled') === 'true') continue;
    if (a.hasAttribute('disabled')) continue;
    if (!(a.offsetParent || a.getClientRects().length > 0)) continue; // not visible
    const raw = a.getAttribute('href') ?? '';
    const trimmed = raw.replace(/\/$/, '') || '/';
    if (trimmed === want) return a;
    try {
      const u = new URL(a.href, location.origin);
      const pn = u.pathname.replace(/\/$/, '') || '/';
      if (pn === want) return a;
    } catch { /* ignore malformed hrefs */ }
  }
  return null;
}

export async function* executeLoop(
  agent: WebAgent,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  const session = agent.sessionRef;
  if (!session) return;
  let errorCount = 0;

  for (let stepIdx = 0; stepIdx < agent.configRef.maxSteps; stepIdx++) {
    if (signal.aborted) {
      agent.setStatusInternal('idle');
      return;
    }

    // SPA nav detection between iterations.
    const nowUrl = typeof location !== 'undefined' ? location.pathname + location.search : null;
    if (nowUrl && session.currentPage !== nowUrl) {
      const from = session.currentPage;
      session.currentPage = nowUrl;
      agent.persistSessionInternal();
      yield { kind: 'navigated', from, to: nowUrl };
    }

    agent.setStatusInternal('thinking');
    yield { kind: 'thinking' };

    let toolCall: ToolCall | undefined;
    let textBuffer = '';
    try {
      for await (const ev of callLlmStream(agent, signal)) {
        if (signal.aborted) { agent.setStatusInternal('idle'); return; }
        if (ev.kind === 'text-delta' && ev.delta) {
          textBuffer += ev.delta;
          yield ev;
        } else if (ev.kind === 'tool-call') {
          toolCall = ev.call;
          // Let the stream finish so finishReason / usage land; no more
          // text deltas matter once the tool is known.
        }
      }
      errorCount = 0;
    } catch (err) {
      if (signal.aborted) { agent.setStatusInternal('idle'); return; }
      errorCount += 1;
      const retrying = errorCount < agent.configRef.maxErrors;
      yield { kind: 'error', error: err as Error, retrying };
      if (!retrying) {
        agent.setStatusInternal('failed');
        return;
      }
      await sleep(400 * Math.pow(2, errorCount - 1));
      continue;
    }

    // No tool call → final paragraph. Done.
    if (!toolCall) {
      if (textBuffer) pushAgentFinal(session, textBuffer);
      agent.setStatusInternal('idle');
      yield { kind: 'final' };
      return;
    }

    const matched = agent.actionsRef.get(toolCall.name);

    const needsConfirm = await agent.needsConfirmationInternal(toolCall, matched, signal);
    if (needsConfirm) {
      const locale = agent.configRef.locale ?? 'en';
      // Precedence: per-action override → host-level override → SDK default.
      const message = matched?.confirmationMessage?.(toolCall.arguments as never)
        ?? agent.configRef.buildConfirmMessage?.(toolCall.name, toolCall.arguments, locale)
        ?? narrateAction(toolCall.name, toolCall.arguments, locale);
      let resolveConfirm!: (ok: boolean) => void;
      const approvedPromise = new Promise<boolean>((r) => { resolveConfirm = r; });
      agent.setStatusInternal('waiting');
      yield {
        kind: 'confirm',
        actionName: toolCall.name,
        args: toolCall.arguments,
        message,
        decide: resolveConfirm,
      };
      const approved = await Promise.race([
        approvedPromise,
        new Promise<boolean>((_, reject) => {
          const onAbort = (): void => { signal.removeEventListener('abort', onAbort); reject(new Error('aborted')); };
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]).catch(() => false);
      if (!approved) {
        const result: ActionResult = { ok: false, reason: 'user_declined' };
        pushAgentStep(session, {
          preText: textBuffer || undefined,
          toolCall: { name: toolCall.name, arguments: toolCall.arguments },
          toolCallId: toolCall.id,
          result,
        });
        agent.persistSessionInternal();
        yield { kind: 'tool-end', name: toolCall.name, result, toolCallId: toolCall.id };
        continue;
      }
    }

    const targetSelector = extractTargetSelector(toolCall.arguments);
    yield {
      kind: 'tool-start',
      name: toolCall.name,
      args: toolCall.arguments,
      targetSelector,
      toolCallId: toolCall.id,
    };

    let result: ActionResult;
    if (toolCall.name === 'navigate') {
      agent.setStatusInternal('navigating');
      const path = String(toolCall.arguments.path ?? '');
      const from = session.currentPage;
      // Surface the loading beat BEFORE the router fires so the host can
      // show a loading indicator until `navigated` arrives.
      yield { kind: 'navigating', from, to: path };

      // v0.2.0 ROADMAP — preferClickLinkOverNavigate.
      // When the host opts in, look for a visible <a href="${path}"> on
      // the page and trigger it like a user click (with the synthetic
      // cursor if cursorTrail is also on). This keeps demos looking like
      // a human navigating instead of a history.pushState ghost. Falls
      // through to the standard bridge when no matching link exists.
      let linkClicked = false;
      if (agent.configRef.preferClickLinkOverNavigate && typeof document !== 'undefined') {
        const anchor = findNavLink(path);
        if (anchor) {
          try {
            if (agent.configRef.cursorTrail) {
              const { moveCursorAndTap } = await import('../cursor');
              await moveCursorAndTap(anchor);
            }
            anchor.click();
            linkClicked = true;
            await new Promise((r) => setTimeout(r, 80));
          } catch {
            linkClicked = false;
          }
        }
      }
      try {
        if (!linkClicked) {
          const bridgeResult = agent.navigateBridgeRef?.(path);
          // Hosts whose router returns a Promise: await for the real
          // "render complete" signal before declaring nav done.
          if (bridgeResult && typeof (bridgeResult as Promise<void>).then === 'function') {
            await bridgeResult;
          }
        }
      } catch (err) {
        result = { ok: false, reason: 'navigation', message: (err as Error).message };
        yield { kind: 'tool-end', name: 'navigate', result, toolCallId: toolCall.id };
        pushAgentStep(session, {
          preText: textBuffer || undefined,
          toolCall: { name: toolCall.name, arguments: toolCall.arguments },
          toolCallId: toolCall.id,
          result,
        });
        agent.persistSessionInternal();
        continue;
      }
      // Stabilisation — components may still be hydrating / lazy chunks
      // fetching even after the router resolves. Idle-watch with 250ms
      // quiet window, 2.5s ceiling.
      await awaitNavSettle(2500);
      yield { kind: 'navigated', from, to: path };
      // Continuation hint in the tool result so the next LLM turn sees,
      // in the tool message itself, that arrival isn't the end. Without
      // this, smaller models often emit finish_reason=stop right after
      // navigate succeeds.
      result = {
        ok: true,
        data: {
          path,
          arrivedAt: path,
          note: 'Navigation complete — you are NOW at this URL. The user\'s original task is not done yet; the navigate was a means to an end. Continue immediately: read the new page DOM in the next message, pick the first subject in reading order, border it, narrate 1-3 sentences quoting the actual visible text, then call pause. Do NOT stop the loop here.',
        },
      };
    } else {
      const wasUserFacing = toolCall.name === 'ask_user' || toolCall.name === 'ask_user_choice';
      agent.setStatusInternal(wasUserFacing ? 'waiting' : 'executing');
      result = await executeAction(
        {
          actions: agent.actionsRef,
          indexMap: agent.currentIndexMap,
          registerPendingResolver: (r) => agent.registerPendingResolverInternal(r),
          emitAskUser: (payload) => {
            if (agent.askUserHandlerRef) agent.askUserHandlerRef(payload);
            else payload.resolve('');
          },
          emitAskUserChoice: (payload) => {
            if (agent.askUserChoiceHandlerRef) agent.askUserChoiceHandlerRef(payload);
            else payload.resolve('');
          },
          emitPause: (payload) => {
            if (agent.pauseHandlerRef) agent.pauseHandlerRef(payload);
            // Fallback: ask_user envelope so the gesture still works
            // when the host hasn't wired setPauseHandler.
            else if (agent.askUserHandlerRef) {
              agent.askUserHandlerRef({ question: payload.hint, resolve: payload.resolve });
            } else {
              payload.resolve('');
            }
          },
          emitPresentSurface: agent.surfaceMounterRef
            ? (payload) => agent.surfaceMounterRef!(payload)
            : undefined,
          session,
          defaultPauseNote:
            agent.configRef.defaultPauseNote ?? sdkString(agent.configRef.locale, 'agent.press_space_continue'),
          uiHints: {
            cursorTrail: agent.configRef.cursorTrail,
            preferClickLinkOverNavigate: agent.configRef.preferClickLinkOverNavigate,
          },
        },
        toolCall.name,
        toolCall.arguments,
        signal,
      );
    }

    yield { kind: 'tool-end', name: toolCall.name, result, toolCallId: toolCall.id };

    pushAgentStep(session, {
      preText: textBuffer || undefined,
      toolCall: { name: toolCall.name, arguments: toolCall.arguments },
      toolCallId: toolCall.id,
      result,
    });
    agent.persistSessionInternal();

    if (!result.ok) {
      errorCount += 1;
      if (errorCount >= agent.configRef.maxErrors) {
        agent.setStatusInternal('failed');
        return;
      }
    } else {
      errorCount = 0;
    }
  }

  // maxSteps hit. Yield `final` so the orchestrator's closure hook still
  // renders the closing UI (otherwise the subtitle bar just disappears,
  // which reads as broken).
  agent.setStatusInternal('failed');
  yield { kind: 'final' };
}

/**
 * One-shot planning call run before the CoT turn loop. Resulting TaskPlan
 * is stored on session.plan so subsequent turns render `# Master plan`
 * in the system prompt and mutate via todo_adjust. Fail-loud — a thrown
 * error propagates to the consumer's runStream() iterator.
 *
 * Returns `true` if the loop should continue, `false` to abort.
 */
export async function* executePlanningPhase(
  agent: WebAgent,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent, boolean, void> {
  const session = agent.sessionRef!;
  if (!agent.configRef.planner || session.plan) return true;

  agent.setStatusInternal('thinking');
  yield { kind: 'thinking' };
  const latestUser = lastUserTurn(session);
  const taskText = latestUser?.text ?? '';
  console.info('[dddk webagent] planning start', { task: taskText });
  try {
    // Streaming announcement: the planner calls onSummaryDelta as nano
    // types each char of `task_summary`. We push deltas to a queue +
    // resume a waiter so the outer for-loop can yield them as
    // text-delta AgentEvents WHILE the planner promise is still
    // in-flight. After plan resolves we drain any tail deltas then
    // pause for Space.
    const announce = agent.configRef.announcePlan;
    const deltaQueue: string[] = [];
    let waiter: (() => void) | null = null;
    let plannerDone = false;
    // v0.2.0 — feed the planner a snapshot of the current page DOM so
    // it can reason about routes / sections that EXIST IN THE PAGE
    // but weren't listed in the briefed sitemap. Off by setting
    // `plannerSeesDom: false`. Capped by `plannerDomMaxLength`
    // (default 8000) so the strategic one-shot stays cheap.
    let pageContextForPlanner: string | undefined;
    if (agent.configRef.plannerSeesDom !== false && typeof document !== 'undefined') {
      try {
        const { readDOM } = await import('../dom-reader');
        const cap = agent.configRef.plannerDomMaxLength ?? 8000;
        const snap = readDOM({ filter: agent.configRef.domFilter, maxLength: cap });
        if (snap.text) {
          pageContextForPlanner =
            `# Current page DOM (the agent's eyes — use this to plan navigation, not just the briefed sitemap)\n\n` +
            snap.text;
        }
      } catch { /* planner falls back to sitemap-only */ }
    }
    const plannerPromise = agent.configRef.planner({
      task: taskText,
      sitemap: agent.configRef.sitemap,
      brand: agent.configRef.brand,
      persona: agent.configRef.persona,
      locale: agent.configRef.locale,
      selection: agent.currentSelectionRef ?? undefined,
      hostContext: pageContextForPlanner,
      onSummaryDelta: announce
        ? (delta: string) => {
            if (!delta) return;
            deltaQueue.push(delta);
            if (waiter) { const w = waiter; waiter = null; w(); }
          }
        : undefined,
    } as Parameters<NonNullable<typeof agent.configRef.planner>>[0]);
    plannerPromise.finally(() => {
      plannerDone = true;
      if (waiter) { const w = waiter; waiter = null; w(); }
    });
    // Drain loop: yield deltas as they arrive, sleep on a waiter when
    // empty, exit when planner resolved AND queue empty.
    while (!plannerDone || deltaQueue.length > 0) {
      if (deltaQueue.length > 0) {
        yield { kind: 'text-delta', delta: deltaQueue.shift()! };
        continue;
      }
      if (!plannerDone) {
        await new Promise<void>((resolve) => { waiter = resolve; });
      }
    }
    const plan = await plannerPromise;
    session.plan = plan;
    agent.persistSessionInternal();
    console.info('[dddk webagent] planning result', {
      task_summary: plan.task_summary,
      todoCount: plan.todos.length,
      todos: plan.todos,
    });
    if (announce && plan.task_summary?.trim()) {
      // Newline after summary for visual breathing room before pause hint.
      yield { kind: 'text-delta', delta: '\n' };
      // Wait for user ack before turn 1 — otherwise the first turn's
      // confirm dialog covers the announce before the user can read it.
      if (agent.pauseHandlerRef) {
        agent.setStatusInternal('waiting');
        const pauseHint = sdkString(agent.configRef.locale, 'agent.press_space_continue');
        const resolution = await new Promise<string>((resolve) => {
          agent.pauseHandlerRef!({ hint: pauseHint, resolve });
        });
        if (signal.aborted || resolution === '') {
          agent.setStatusInternal('idle');
          return false;
        }
      }
    }
    return true;
  } catch (err) {
    if (signal.aborted) { agent.setStatusInternal('idle'); return false; }
    console.warn('[dddk webagent] planning failed', err);
    yield { kind: 'error', error: err as Error, retrying: false };
    agent.setStatusInternal('failed');
    return false;
  }
}

/**
 * Dispatch a single CoT-envelope action (narrate or tool). Yields
 * AgentEvents and mutates `state` so the caller can observe whether
 * the page changed, whether an end was requested, etc.
 *
 * Two callers in v0.2.0:
 *
 *   1. Streaming path — fires from `executeCotLoop` as the envelope
 *      parser emits `narrate_complete` / `tool_args_complete` events.
 *      Each action runs to completion before the next parser event
 *      is consumed (the LLM stream buffers in the meantime).
 *
 *   2. Non-streaming fallback — fires from `executeCotLoop` after the
 *      full agent_turn tool call lands, iterating turn.actions[] in
 *      order. Same code path so behavior is identical.
 *
 * `skipNarrateTypewriter=true` is used by the streaming path because
 * narrate text was already streamed live via `narrate_delta` events.
 * Fallback path leaves it false → original 4ms/char paced typewriter.
 */
async function* dispatchOneAction(
  agent: WebAgent,
  signal: AbortSignal,
  stepIdx: number,
  ai: number,
  action: { narrate?: string; about?: string; tool?: string; args?: Record<string, unknown> },
  state: DispatchState,
  options: { skipNarrateTypewriter?: boolean },
): AsyncIterable<AgentEvent> {
  const session = agent.sessionRef;
  if (!session) return;

  if (isNarrateAction(action as never)) {
    agent.setStatusInternal('executing');
    const narrateAction = action as { narrate: string; about?: string };
    const about = narrateAction.about;
    if (about && about.trim().length > 0) {
      const borderAction = agent.actionsRef.get('border');
      if (borderAction) {
        const synthId = `cot_about_${stepIdx}_${ai}_${Math.random().toString(36).slice(2, 6)}`;
        yield {
          kind: 'tool-start',
          name: 'border',
          args: { selector: about },
          targetSelector: about,
          toolCallId: synthId,
        };
        const borderResult = await executeAction(
          {
            actions: agent.actionsRef,
            indexMap: agent.currentIndexMap,
            registerPendingResolver: (r) => agent.registerPendingResolverInternal(r),
            emitAskUser: () => {},
            emitAskUserChoice: () => {},
            emitPause: () => {},
            emitPresentSurface: undefined,
            session,
            defaultPauseNote: '',
          },
          'border',
          { selector: about },
          signal,
        );
        yield { kind: 'tool-end', name: 'border', result: borderResult, toolCallId: synthId };
        state.actionResults.push({
          type: 'tool',
          name: 'border',
          ok: borderResult.ok,
          reason: borderResult.ok ? undefined : borderResult.reason,
          data: borderResult.ok ? borderResult.data : undefined,
        });
      }
    }

    // Skip the typewriter when narrate already streamed live via parser.
    if (!options.skipNarrateTypewriter) {
      const NARRATE_CHUNK_SIZE = 2;
      const NARRATE_CHUNK_DELAY_MS = 8;
      for (let i = 0; i < narrateAction.narrate.length; i += NARRATE_CHUNK_SIZE) {
        if (signal.aborted) { agent.setStatusInternal('idle'); return; }
        yield { kind: 'text-delta', delta: narrateAction.narrate.slice(i, i + NARRATE_CHUNK_SIZE) };
        await sleep(NARRATE_CHUNK_DELAY_MS);
      }
    }
    state.actionResults.push({ type: 'narrate', text: narrateAction.narrate });

    let skipPause = false;
    if (isUserEditingInPalette()) skipPause = true;
    if (agent.configRef.disableAutoPauseAfterNarrate === true) skipPause = true;

    if (!skipPause && agent.pauseHandlerRef) {
      agent.setStatusInternal('waiting');
      const pauseHint = sdkString(agent.configRef.locale, 'agent.press_space_continue');
      const resolution = await new Promise<string>((resolve) => {
        agent.pauseHandlerRef!({ hint: pauseHint, resolve });
      });
      if (signal.aborted || resolution === '') {
        agent.setStatusInternal('idle');
        return;
      }
    }
    return;
  }

  if (isToolAction(action as never)) {
    const toolAction = action as { tool: string; args?: Record<string, unknown> };
    const synth: ToolCall = {
      id: `cot_${stepIdx}_${Math.random().toString(36).slice(2, 8)}`,
      name: toolAction.tool,
      arguments: toolAction.args ?? {},
    };
    if (TOOLS_REQUIRING_NEXT_REACTION_SET.has(synth.name)) {
      state.executedReactionRequiringTool = true;
    }
    const matched = agent.actionsRef.get(synth.name);

    const needsConfirm = await agent.needsConfirmationInternal(synth, matched, signal);
    if (needsConfirm) {
      const locale = agent.configRef.locale ?? 'en';
      const message = matched?.confirmationMessage?.(synth.arguments as never)
        ?? agent.configRef.buildConfirmMessage?.(synth.name, synth.arguments, locale)
        ?? narrateAction(synth.name, synth.arguments, locale);
      let resolveConfirm!: (ok: boolean) => void;
      const approvedPromise = new Promise<boolean>((r) => { resolveConfirm = r; });
      agent.setStatusInternal('waiting');
      yield {
        kind: 'confirm',
        actionName: synth.name,
        args: synth.arguments,
        message,
        decide: resolveConfirm,
      };
      const approved = await Promise.race([
        approvedPromise,
        new Promise<boolean>((_, reject) => {
          const onAbort = (): void => { signal.removeEventListener('abort', onAbort); reject(new Error('aborted')); };
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]).catch(() => false);
      if (!approved) {
        const result: ActionResult = { ok: false, reason: 'user_declined' };
        yield { kind: 'tool-end', name: synth.name, result, toolCallId: synth.id };
        state.actionResults.push({ type: 'tool', name: synth.name, ok: false, reason: 'user_declined' });
        return;
      }
    }

    const targetSelector = extractTargetSelector(synth.arguments);
    yield { kind: 'tool-start', name: synth.name, args: synth.arguments, targetSelector, toolCallId: synth.id };

    let result: ActionResult;
    if (synth.name === 'navigate') {
      const path = String(synth.arguments.path ?? '').trim();
      if (!path) {
        result = { ok: false, reason: 'unknown', message: 'navigate requires a non-empty `path` arg (e.g. "/docs")' };
        yield { kind: 'tool-end', name: 'navigate', result, toolCallId: synth.id };
        state.actionResults.push({ type: 'tool', name: 'navigate', ok: false, reason: 'missing path' });
        state.actionErrorThisTurn += 1;
        return;
      }
      agent.setStatusInternal('navigating');
      const from = session.currentPage;
      yield { kind: 'navigating', from, to: path };
      try {
        const bridgeResult = agent.navigateBridgeRef?.(path);
        if (bridgeResult && typeof (bridgeResult as Promise<void>).then === 'function') {
          await bridgeResult;
        }
      } catch (err) {
        result = { ok: false, reason: 'navigation', message: (err as Error).message };
        yield { kind: 'tool-end', name: 'navigate', result, toolCallId: synth.id };
        state.actionResults.push({ type: 'tool', name: synth.name, ok: false, reason: 'navigation' });
        state.actionErrorThisTurn += 1;
        return;
      }
      await awaitNavSettle(2500);
      yield { kind: 'navigated', from, to: path };
      result = { ok: true, data: { path, arrivedAt: path } };
      state.pageChanged = true;
    } else {
      const wasUserFacing = synth.name === 'ask_user' || synth.name === 'ask_user_choice';
      agent.setStatusInternal(wasUserFacing ? 'waiting' : 'executing');
      result = await executeAction(
        {
          actions: agent.actionsRef,
          indexMap: agent.currentIndexMap,
          registerPendingResolver: (r) => agent.registerPendingResolverInternal(r),
          emitAskUser: (payload) => {
            if (agent.askUserHandlerRef) agent.askUserHandlerRef(payload);
            else payload.resolve('');
          },
          emitAskUserChoice: (payload) => {
            if (agent.askUserChoiceHandlerRef) agent.askUserChoiceHandlerRef(payload);
            else payload.resolve('');
          },
          emitPause: (payload) => {
            if (agent.pauseHandlerRef) agent.pauseHandlerRef(payload);
            else if (agent.askUserHandlerRef) {
              agent.askUserHandlerRef({ question: payload.hint, resolve: payload.resolve });
            } else {
              payload.resolve('');
            }
          },
          emitPresentSurface: agent.surfaceMounterRef
            ? (payload) => agent.surfaceMounterRef!(payload)
            : undefined,
          session,
          defaultPauseNote:
            agent.configRef.defaultPauseNote ?? sdkString(agent.configRef.locale, 'agent.press_space_continue'),
        },
        synth.name,
        synth.arguments,
        signal,
      );
    }

    yield { kind: 'tool-end', name: synth.name, result, toolCallId: synth.id };
    state.actionResults.push({
      type: 'tool',
      name: synth.name,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      data: result.ok ? result.data : undefined,
    });
    if (!result.ok) state.actionErrorThisTurn += 1;
  }
}

export async function* executeCotLoop(
  agent: WebAgent,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  const session = agent.sessionRef;
  if (!session) return;

  const planContinue = yield* executePlanningPhase(agent, signal);
  if (!planContinue) return;

  let errorCount = 0;

  // Reaction-requiring tools whose result the model MUST observe before
  // the run can finish. If is_final lands in the same turn as any of
  // these, we drop is_final (the run isn't actually done yet).
  const TOOLS_REQUIRING_NEXT_REACTION = new Set(['ask_user_choice', 'ask_user', 'navigate']);

  for (let stepIdx = 0; stepIdx < agent.configRef.maxSteps; stepIdx++) {
    if (signal.aborted) { agent.setStatusInternal('idle'); return; }

    // SPA nav detection between iterations.
    const nowUrl = typeof location !== 'undefined' ? location.pathname + location.search : null;
    if (nowUrl && session.currentPage !== nowUrl) {
      const from = session.currentPage;
      session.currentPage = nowUrl;
      agent.persistSessionInternal();
      yield { kind: 'navigated', from, to: nowUrl };
    }

    agent.setStatusInternal('thinking');
    yield { kind: 'thinking' };

    // Single forced tool call to `agent_turn`. Stray text deltas are
    // ignored (schema doesn't allow them; we tolerate misbehaving providers).
    let agentTurnCall: ToolCall | undefined;
    // v0.2.0 streaming-envelope: when the flag is on, the parser
    // dispatches each action AS the LLM types it, instead of waiting
    // for the full envelope JSON to settle. Per-action mid-stream
    // dispatch — narrate text typewriters live in the subtitle bar
    // AND the first tool action fires before the LLM has finished
    // emitting later actions.
    const useStreamingEnvelope = !!agent.configRef.enableStreamingEnvelope;
    let envelopeParser: import('./streaming-envelope').StreamingEnvelopeParser | null = null;
    let envelopeParserBailed = false;
    if (useStreamingEnvelope) {
      const { StreamingEnvelopeParser } = await import('./streaming-envelope');
      envelopeParser = new StreamingEnvelopeParser();
    }

    // Streaming dispatch state — shared with the fallback path so the
    // turn finalisation block at the bottom doesn't need to branch.
    const dispatchState: DispatchState = {
      actionResults: [],
      pageChanged: false,
      endLoopRequested: false,
      executedReactionRequiringTool: false,
      actionErrorThisTurn: 0,
    };
    // Per-index field accumulators — about_complete fires before the
    // matching narrate_complete, so stash and pick up on the completion.
    const perActionAbout = new Map<number, string>();
    // Envelope-scoped fields the parser surfaces for finalisation.
    let envelopeMemory: string | undefined;
    let envelopeTodoAdjust: { remove?: string[]; replace?: Array<{ id: string; new_description: string; new_intent?: string }> } | undefined;
    let envelopeTodosRemaining: string[] | undefined;
    let envelopeIsFinal = false;
    let envelopeCompleteFired = false;
    let dispatchedAnyStreaming = false;
    // Once pageChanged / endLoopRequested fires mid-stream, the remaining
    // queued actions (next turn would re-plan against the new DOM) should
    // be skipped. We keep draining the LLM stream so the request closes
    // cleanly, but ignore further `*_complete` events from the parser.
    let stopDispatchingFurther = false;

    // Apply todo_adjust to the session plan. Mirrors the original
    // post-parse logic, just done as soon as parser surfaces it so any
    // ensuing actions see the updated plan.
    const applyTodoAdjust = (adjust: typeof envelopeTodoAdjust): void => {
      if (!adjust || !session.plan) return;
      if (adjust.remove?.length) {
        for (const id of adjust.remove) {
          session.plan.todos = session.plan.todos.filter((t) => t.id !== id);
        }
      }
      if (adjust.replace?.length) {
        for (const r of adjust.replace) {
          const idx = session.plan.todos.findIndex((t) => t.id === r.id);
          if (idx < 0) continue;
          session.plan.todos[idx] = {
            ...session.plan.todos[idx]!,
            description: r.new_description,
            ...(r.new_intent ? { intent: r.new_intent } : {}),
          };
        }
      }
      agent.persistSessionInternal();
    };

    // Inner generator: dispatch one event from the parser. Yields any
    // AgentEvents emitted by sub-dispatches. Sets stopDispatchingFurther
    // when the action causes a navigate or signals end-of-loop.
    async function* handleParserEvent(e: EnvelopeStreamEvent): AsyncIterable<AgentEvent> {
      switch (e.kind) {
        case 'memory_complete':
          envelopeMemory = e.value;
          break;
        case 'turn_planning_complete':
          // No mid-stream side effect — planning is informational.
          break;
        case 'todo_adjust_complete':
          envelopeTodoAdjust = e.value as typeof envelopeTodoAdjust;
          applyTodoAdjust(envelopeTodoAdjust);
          break;
        case 'todos_remaining_complete':
          envelopeTodosRemaining = e.value;
          break;
        case 'action_start':
          // Reset per-action accumulator slot.
          perActionAbout.delete(e.index);
          break;
        case 'about_complete':
          perActionAbout.set(e.index, e.value);
          break;
        case 'narrate_delta':
          if (e.delta) {
            console.info('[dddk stream] narrate_delta', { idx: e.index, delta: e.delta });
            yield { kind: 'text-delta', delta: e.delta };
          }
          break;
        case 'narrate_complete': {
          console.info('[dddk stream] narrate_complete', { idx: e.index, len: e.full.length });
          if (stopDispatchingFurther) break;
          dispatchedAnyStreaming = true;
          const about = perActionAbout.get(e.index);
          yield* dispatchOneAction(
            agent,
            signal,
            stepIdx,
            e.index,
            { narrate: e.full, about },
            dispatchState,
            { skipNarrateTypewriter: true },
          );
          if (dispatchState.pageChanged) stopDispatchingFurther = true;
          break;
        }
        case 'tool_args_complete': {
          console.info('[dddk stream] tool_args_complete', { idx: e.index, tool: e.tool, args: e.args });
          if (stopDispatchingFurther) break;
          dispatchedAnyStreaming = true;
          yield* dispatchOneAction(
            agent,
            signal,
            stepIdx,
            e.index,
            { tool: e.tool, args: e.args as Record<string, unknown> },
            dispatchState,
            { skipNarrateTypewriter: true },
          );
          if (dispatchState.pageChanged) stopDispatchingFurther = true;
          break;
        }
        case 'is_final_complete':
          envelopeIsFinal = e.value;
          break;
        case 'envelope_complete':
          envelopeCompleteFired = true;
          console.info('[dddk stream] envelope_complete (turn finished streaming)');
          break;
      }
    }

    let streamFragCount = 0;
    try {
      for await (const ev of callLlmStream(agent, signal)) {
        if (signal.aborted) { agent.setStatusInternal('idle'); return; }
        if (ev.kind === 'tool-args-delta' && ev.name === AGENT_TURN_TOOL) {
          streamFragCount += 1;
          // Log EVERY fragment regardless of parser state. The previous
          // version gated logging on `!envelopeParserBailed`, which made
          // post-bail fragments invisible — looked like "stream ended
          // after 1 fragment" when actually 300+ kept flowing through.
          console.info(`[dddk stream] frag #${streamFragCount}`, { len: ev.deltaText.length, text: ev.deltaText });
          if (envelopeParser && !envelopeParserBailed) {
            const events = envelopeParser.feed(ev.deltaText);
            if (events === null) {
              envelopeParserBailed = true; // unknown shape — fall back to JSON-parse path
              console.warn(`[dddk stream] parser bailed at frag #${streamFragCount} — falling back to JSON-parse path`);
            } else {
              for (const e of events) {
                yield* handleParserEvent(e);
              }
            }
          }
        }
        if (ev.kind === 'tool-call' && ev.call.name === AGENT_TURN_TOOL) {
          agentTurnCall = ev.call;
        }
      }
      if (streamFragCount > 0) {
        console.info(`[dddk stream] LLM stream ended after ${streamFragCount} fragments`);
      }
      // Flush any tail-end envelope events.
      if (envelopeParser && !envelopeParserBailed) {
        const tail = envelopeParser.finish();
        if (tail) {
          for (const e of tail) {
            yield* handleParserEvent(e);
          }
        }
      }
      errorCount = 0;
    } catch (err) {
      if (signal.aborted) { agent.setStatusInternal('idle'); return; }
      errorCount += 1;
      const retrying = errorCount < agent.configRef.maxErrors;
      yield { kind: 'error', error: err as Error, retrying };
      if (!retrying) { agent.setStatusInternal('failed'); return; }
      await sleep(400 * Math.pow(2, errorCount - 1));
      continue;
    }

    if (!agentTurnCall) {
      // Provider didn't comply with toolChoice — treat as done so the
      // user isn't stuck in an empty loop.
      agent.setStatusInternal('idle');
      yield { kind: 'final' };
      return;
    }

    // Decide which path finalises this turn:
    //  - Streaming path: parser saw envelope_complete AND we dispatched
    //    at least one action. Skip JSON-parse, trust dispatchState.
    //  - Streaming partial: we dispatched some actions but stream broke
    //    or parser bailed mid-way. Don't re-dispatch — finalise with
    //    what we have so action history doesn't double up.
    //  - Fallback path: streaming off, or parser bailed before any
    //    dispatch. Parse the full tool-call args + run the dispatch
    //    loop using the same helper.
    const useStreamingFinalize = dispatchedAnyStreaming;

    if (useStreamingFinalize) {
      // Apply is_final closure under the same reaction-requiring-tool
      // rule the fallback path uses.
      if (envelopeIsFinal && !dispatchState.executedReactionRequiringTool) {
        dispatchState.actionResults.push({ type: 'done' });
        dispatchState.endLoopRequested = true;
      } else if (envelopeIsFinal && dispatchState.executedReactionRequiringTool) {
        console.warn('[dddk webagent] dropping is_final=true — turn included a reaction-requiring tool; the run is not actually finished yet');
      }

      const envelopeData = {
        memory: envelopeMemory,
        todos_remaining: envelopeTodosRemaining,
        action_results: dispatchState.actionResults,
        page_changed: dispatchState.pageChanged,
        streamed: true,
      };
      const turnSummary: Record<string, unknown> = {
        turn: stepIdx + 1,
        url: session.currentPage,
        memory: envelopeMemory,
        streamed: true,
      };
      if (envelopeTodosRemaining !== undefined) turnSummary.todos_remaining = envelopeTodosRemaining;
      if (envelopeTodoAdjust) turnSummary.todo_adjust = envelopeTodoAdjust;
      if (session.plan) {
        turnSummary.master_todos = session.plan.todos.map((t) => `${t.id}:${t.intent}:${t.description}`);
      }
      turnSummary.action_results = dispatchState.actionResults;
      if (envelopeIsFinal) turnSummary.is_final = true;
      console.info('[dddk webagent] turn summary (after-the-fact)', turnSummary);

      pushAgentStep(session, {
        toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
        toolCallId: agentTurnCall.id,
        result: dispatchState.actionErrorThisTurn === 0
          ? { ok: true, data: envelopeData }
          : { ok: false, reason: 'unknown', message: JSON.stringify(envelopeData) },
      });
      agent.persistSessionInternal();

      if (dispatchState.actionErrorThisTurn > 0) {
        errorCount += 1;
        if (errorCount >= agent.configRef.maxErrors) {
          agent.setStatusInternal('failed');
          return;
        }
      } else {
        errorCount = 0;
      }

      if (dispatchState.endLoopRequested) {
        agent.setStatusInternal('idle');
        yield { kind: 'final' };
        return;
      }
      continue;
    }

    // Fallback: streaming disabled, or parser bailed before any
    // action dispatched. Parse the full envelope and run the dispatch
    // loop sequentially.
    const turn = parseTurnResponse(agentTurnCall.arguments);
    if (!turn) {
      errorCount += 1;
      const result: ActionResult = { ok: false, reason: 'unknown', message: 'invalid agent_turn envelope' };
      console.warn('[dddk webagent] turn parse failed', {
        rawArguments: agentTurnCall.arguments,
      });
      recordParseFail(agentTurnCall.arguments);
      pushAgentStep(session, {
        toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
        toolCallId: agentTurnCall.id,
        result,
      });
      agent.persistSessionInternal();
      yield { kind: 'tool-end', name: AGENT_TURN_TOOL, result, toolCallId: agentTurnCall.id };
      if (errorCount >= agent.configRef.maxErrors) { agent.setStatusInternal('failed'); return; }
      continue;
    }

    const turnSummary: Record<string, unknown> = {
      turn: stepIdx + 1,
      url: session.currentPage,
      memory: turn.memory,
    };
    if (turn.todos_remaining !== undefined) turnSummary.todos_remaining = turn.todos_remaining;
    if (turn.turn_planning) turnSummary.turn_planning = turn.turn_planning;
    if (turn.todo_adjust) turnSummary.todo_adjust = turn.todo_adjust;
    if (session.plan) {
      turnSummary.master_todos = session.plan.todos.map((t) => `${t.id}:${t.intent}:${t.description}`);
    }
    turnSummary.actions = turn.actions.map((a) => {
      if (isNarrateAction(a)) {
        return { narrate: a.narrate.length > 100 ? a.narrate.slice(0, 100) + '…' : a.narrate };
      }
      return { tool: (a as { tool: string }).tool, args: (a as { args?: unknown }).args };
    });
    if (turn.is_final) turnSummary.is_final = true;
    console.info('[dddk webagent] turn', turnSummary);
    recordTurn(turnSummary, turn);

    // Apply todo_adjust mutations BEFORE dispatching actions.
    if (turn.todo_adjust && session.plan) {
      if (turn.todo_adjust.remove?.length) {
        for (const id of turn.todo_adjust.remove) {
          session.plan.todos = session.plan.todos.filter((t) => t.id !== id);
        }
      }
      if (turn.todo_adjust.replace?.length) {
        for (const r of turn.todo_adjust.replace) {
          const idx = session.plan.todos.findIndex((t) => t.id === r.id);
          if (idx < 0) continue;
          session.plan.todos[idx] = {
            ...session.plan.todos[idx]!,
            description: r.new_description,
            ...(r.new_intent ? { intent: r.new_intent } : {}),
          };
        }
      }
      agent.persistSessionInternal();
    }

    // Legacy-mode orphan-tool normalisation.
    if (turn.todos_remaining !== undefined && turn.todos_remaining.length === 0 && turn.actions.length > 0) {
      const hasNarrate = turn.actions.some((a) => isNarrateAction(a));
      if (!turn.is_final && !hasNarrate) {
        if (typeof console !== 'undefined') {
          console.info('[dddk webagent] todos empty + actions has only tools without is_final → ' + turn.actions.length + ' queued actions normalized away; loop ends');
        }
        turn.actions = [];
      }
    }

    if (turn.actions.length === 0) {
      pushAgentStep(session, {
        toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
        toolCallId: agentTurnCall.id,
        result: {
          ok: true,
          data: {
            memory: turn.memory,
            todos_remaining: turn.todos_remaining,
            action_count: 0,
            action_results: [],
          },
        },
      });
      agent.persistSessionInternal();
      agent.setStatusInternal('idle');
      yield { kind: 'final' };
      return;
    }

    // Dispatch each action via the shared helper. Same DispatchState
    // shape as the streaming path so the finalisation block below is
    // common.
    for (let ai = 0; ai < turn.actions.length; ai++) {
      if (signal.aborted) { agent.setStatusInternal('idle'); return; }
      if (dispatchState.pageChanged) break;
      yield* dispatchOneAction(
        agent,
        signal,
        stepIdx,
        ai,
        turn.actions[ai] as never,
        dispatchState,
        { skipNarrateTypewriter: false },
      );
    }

    if (turn.is_final && !dispatchState.executedReactionRequiringTool) {
      dispatchState.actionResults.push({ type: 'done' });
      dispatchState.endLoopRequested = true;
    } else if (turn.is_final && dispatchState.executedReactionRequiringTool) {
      console.warn('[dddk webagent] dropping is_final=true — turn included a reaction-requiring tool; the run is not actually finished yet');
    }

    const envelopeData = {
      memory: turn.memory,
      todos_remaining: turn.todos_remaining,
      action_results: dispatchState.actionResults,
      page_changed: dispatchState.pageChanged,
    };
    pushAgentStep(session, {
      toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
      toolCallId: agentTurnCall.id,
      result: dispatchState.actionErrorThisTurn === 0
        ? { ok: true, data: envelopeData }
        : { ok: false, reason: 'unknown', message: JSON.stringify(envelopeData) },
    });
    agent.persistSessionInternal();

    if (dispatchState.actionErrorThisTurn > 0) {
      errorCount += 1;
      if (errorCount >= agent.configRef.maxErrors) {
        agent.setStatusInternal('failed');
        return;
      }
    } else {
      errorCount = 0;
    }

    if (dispatchState.endLoopRequested) {
      agent.setStatusInternal('idle');
      yield { kind: 'final' };
      return;
    }
  }

  // maxSteps hit. Yield `final` so the orchestrator's closure hook still
  // renders the closing UI.
  agent.setStatusInternal('failed');
  yield { kind: 'final' };
}
