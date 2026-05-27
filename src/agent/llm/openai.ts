/**
 * OpenAI provider. Works with Azure OpenAI, OpenRouter, Cloudflare AI Gateway,
 * and any other OpenAI-compatible endpoint via `baseURL`.
 */

import type {
  LLMProvider,
  CompleteOptions,
  CompleteResult,
  LLMMessage,
  ToolCall,
} from './types';
import { buildStream, type StreamHandle, type StreamingProvider } from './stream';
import { redactSecrets } from '../../utils/redact';

export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  organization?: string;
  /** Default request headers (e.g. for self-hosted reverse proxies). */
  headers?: Record<string, string>;
  /**
   * Vendor-specific request body fields merged into every request. The
   * OpenAI Chat Completions shape is a lingua franca — DeepSeek, Qwen,
   * Together, OpenRouter, etc. all accept it but each adds proprietary
   * knobs. Put them here:
   *
   *   new OpenAIProvider({
   *     apiKey, baseURL: 'https://api.deepseek.com/v1',
   *     extraBody: { thinking: { type: 'disabled' } },  // DeepSeek-specific
   *   });
   *
   * Values here are spread shallow-merged into the body AFTER the
   * built-in fields, so they can override `temperature` / `max_tokens` /
   * etc. when needed.
   */
  extraBody?: Record<string, unknown>;
}

export class OpenAIProvider implements LLMProvider, StreamingProvider {
  readonly name = 'openai';

  private apiKey: string;
  private model: string;
  private baseURL: string;
  private headers: Record<string, string>;
  private extraBody: Record<string, unknown>;

  constructor(config: OpenAIProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gpt-5.4-mini';
    this.baseURL = config.baseURL ?? 'https://api.openai.com/v1';
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...(config.organization ? { 'OpenAI-Organization': config.organization } : {}),
      ...(config.headers ?? {}),
    };
    this.extraBody = config.extraBody ?? {};
  }

  private buildBody(opts: CompleteOptions, stream: boolean): Record<string, unknown> {
    const model = opts.model ?? this.model;
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages.map(toOpenAIMessage),
    };

    if (stream) body.stream = true;

    // Two orthogonal model-family axes (see `usesMaxCompletionTokens`
    // and `isReasoningModel` for the matchers):
    //   1. `max_completion_tokens` vs `max_tokens` — all gpt-5+ models
    //      including `-mini` / `-nano` require the new name.
    //   2. Reasoning controls (`reasoning_effort`, no custom temperature) —
    //      only true reasoning models (o-series, gpt-5+ non-mini). The
    //      mini / nano variants still accept temperature.
    // `opts.thinking` is also treated as opt-in to the reasoning shape.
    const newParamShape = usesMaxCompletionTokens(model);
    const reasoning = opts.thinking !== undefined || isReasoningModel(model);

    if (newParamShape) {
      if (opts.maxTokens !== undefined) body.max_completion_tokens = opts.maxTokens;
    } else if (opts.maxTokens !== undefined) {
      body.max_tokens = opts.maxTokens;
    }

    if (reasoning) {
      const hasTools = (opts.tools?.length ?? 0) > 0;
      const wantsReasoning = opts.thinking && opts.thinking !== 'off';
      if (wantsReasoning && !hasTools) {
        body.reasoning_effort = opts.thinking;
      }
    } else {
      body.temperature = opts.temperature ?? 0.7;
    }

    if (opts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }

    // Vendor-specific knobs (DeepSeek `thinking`, etc.) layered last so
    // they can override defaults when the host explicitly sets them.
    return { ...body, ...this.extraBody };
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    const body = this.buildBody(opts, false);
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(
        `OpenAI HTTP ${response.status}: ${redactSecrets(errText, [this.apiKey])}`,
      );
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const choice = data.choices?.[0];
    if (!choice) throw new Error('OpenAI: no choices returned');

    const message = choice.message;
    const toolCalls: ToolCall[] | undefined = message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJson(tc.function.arguments) ?? {},
    }));

    return {
      content: message.content ?? '',
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined,
      finishReason: (choice.finish_reason as CompleteResult['finishReason']) ?? 'stop',
    };
  }

  /**
   * Streaming via OpenAI's SSE `chat/completions?stream=true`. Each event is
   * `data: { ... }` carrying either a text delta or a tool_call fragment.
   * Tool calls stream piecewise — `index` slots; `id` / `function.name` arrive
   * on the first fragment, `function.arguments` accumulates JSON characters
   * across subsequent fragments.
   */
  streamComplete(opts: CompleteOptions): StreamHandle {
    const body = this.buildBody(opts, true);
    const baseURL = this.baseURL;
    const headers = this.headers;
    const apiKey = this.apiKey;

    return buildStream({
      produce: () => streamOpenAI({ url: `${baseURL}/chat/completions`, headers, body, signal: opts.signal, apiKey }),
    });
  }
}

async function* streamOpenAI(args: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  apiKey: string;
}): AsyncIterable<{ delta?: string; toolCall?: ToolCall; finishReason?: CompleteResult['finishReason']; usage?: CompleteResult['usage'] }> {
  const response = await fetch(args.url, {
    method: 'POST',
    headers: args.headers,
    body: JSON.stringify(args.body),
    signal: args.signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI HTTP ${response.status}: ${redactSecrets(errText, [args.apiKey])}`);
  }
  if (!response.body) {
    throw new Error('OpenAI: no response body for stream');
  }

  // Track in-progress tool calls by streaming index. OpenAI emits each
  // tool_call as a sequence of fragments — first one carries `id` and
  // `function.name`, subsequent ones carry `function.arguments` deltas.
  const inflight = new Map<number, { id: string; name: string; argsBuf: string }>();
  // Track which tool calls have been yielded already so we don't re-yield
  // every fragment; we emit a single toolCall event when arguments parse
  // cleanly (typically on the closing `}` or at finish_reason=tool_calls).
  const yielded = new Set<number>();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finishReason: CompleteResult['finishReason'] | undefined;
  let usage: CompleteResult['usage'] | undefined;

  while (true) {
    let value: Uint8Array | undefined;
    let done = false;
    try {
      const r = await reader.read();
      value = r.value;
      done = r.done;
    } catch (err) {
      // User aborted (subtitle ×, Esc, double-tap Space). The fetch's
      // body stream throws AbortError mid-read — treat as a clean stop
      // and return so the loop can wind down without an unhandled
      // rejection bubbling to the console.
      if ((err as Error).name === 'AbortError') return;
      throw err;
    }
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE events are separated by `\n\n`. Each event line starts with `data: `.
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      if (!event.trim()) continue;

      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let parsed: OpenAIStreamChunk;
        try {
          parsed = JSON.parse(payload) as OpenAIStreamChunk;
        } catch {
          continue;
        }
        if (parsed.usage) {
          usage = {
            promptTokens: parsed.usage.prompt_tokens,
            completionTokens: parsed.usage.completion_tokens,
          };
        }
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { delta: delta.content };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const frag of delta.tool_calls) {
            const idx = frag.index ?? 0;
            let entry = inflight.get(idx);
            if (!entry) {
              entry = { id: frag.id ?? `call_${idx}_${Date.now()}`, name: frag.function?.name ?? '', argsBuf: '' };
              inflight.set(idx, entry);
            } else {
              if (frag.id) entry.id = frag.id;
              if (frag.function?.name) entry.name = frag.function.name;
            }
            if (frag.function?.arguments) entry.argsBuf += frag.function.arguments;

            // Try parsing accumulated JSON. If it parses, the tool call is
            // complete enough to dispatch — yield exactly once per index.
            if (entry.name && !yielded.has(idx)) {
              const parsedArgs = safeParseJson(entry.argsBuf);
              if (parsedArgs !== null) {
                yielded.add(idx);
                yield { toolCall: { id: entry.id, name: entry.name, arguments: parsedArgs } };
              }
            }
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason as CompleteResult['finishReason'];
          // Flush any tool calls that didn't get a clean JSON parse yet —
          // emit with whatever we have (best effort, may be empty object).
          for (const [idx, entry] of inflight) {
            if (yielded.has(idx) || !entry.name) continue;
            yielded.add(idx);
            yield { toolCall: { id: entry.id, name: entry.name, arguments: safeParseJson(entry.argsBuf) ?? {} } };
          }
        }
      }
    }
  }

  if (finishReason || usage) {
    yield { finishReason, usage };
  }
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ─── helpers ────────────────────────────────────────────────────────

function toOpenAIMessage(m: LLMMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role };

  if (typeof m.content === 'string') {
    out.content = m.content;
  } else {
    out.content = m.content.map((part) =>
      part.type === 'image'
        ? { type: 'image_url', image_url: { url: part.image } }
        : { type: 'text', text: part.text }
    );
  }

  if (m.toolCallId) out.tool_call_id = m.toolCallId;
  if (m.toolCalls) {
    out.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));
  }
  if (m.name) out.name = m.name;

  return out;
}

/**
 * True for OpenAI true-reasoning models (o-series + gpt-5+ full, NOT mini/nano).
 * These reject custom temperature. The `-mini` / `-nano` variants behave like
 * conventional chat models on the temperature axis.
 */
function isReasoningModel(model: string): boolean {
  return /^(o[1-9](?!.*-mini|.*-nano)|gpt-[5-9](?!.*-mini|.*-nano)|gpt-1\d(?!.*-mini|.*-nano))/i.test(
    model,
  );
}

/**
 * True for models that require `max_completion_tokens` instead of `max_tokens`.
 * Includes ALL gpt-5+ models (mini/nano too) and all o-series. Verified against
 * gpt-5.4-mini which returns 400 "Unsupported parameter: 'max_tokens' is not
 * supported with this model" on `max_tokens`.
 */
function usesMaxCompletionTokens(model: string): boolean {
  return /^(o[1-9]|gpt-[5-9]|gpt-1\d)/i.test(model);
}

function safeParseJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
