/**
 * ProxyProvider — calls the host's own backend instead of OpenAI/Gemini directly.
 *
 * **THE production-safe pattern for BYOK + browser apps.** The user's API key
 * never touches client code: client → your /api/llm endpoint → OpenAI.
 *
 * Your backend implements `/api/llm/complete` (or whatever path), reads the
 * key from `process.env`, and forwards the request. This file is the client
 * half — it sends OpenAI-shaped `CompleteOptions`, expects the standardized
 * `CompleteResult` shape back.
 *
 * See ../../docs/09-security.md for full discussion + a Node.js reference
 * implementation.
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

export interface ProxyProviderConfig {
  /** Endpoint that returns CompleteResult-shaped JSON. */
  endpoint: string;

  /** Method override (default 'POST'). */
  method?: 'POST' | 'PUT';

  /** Extra headers — pass auth tokens etc. */
  headers?: Record<string, string>;

  /**
   * Optional credentials override. Set 'include' if your endpoint is
   * cross-origin and relies on cookies.
   */
  credentials?: RequestCredentials;

  /**
   * Optional request body transformer — if your backend expects a different
   * shape than the default `{ messages, tools, ... }`.
   */
  buildBody?: (opts: CompleteOptions) => unknown;

  /**
   * Optional response transformer — if your backend returns a different
   * shape than `CompleteResult`. Map it here.
   */
  parseResult?: (raw: unknown) => CompleteResult;

  /**
   * Logical model name to advertise — purely informational, controls the
   * `name` field. Default 'proxy'.
   */
  name?: string;

  /**
   * Per-request timeout in milliseconds. The proxy aborts the fetch and
   * throws if no response arrives in this window. Default 30_000 (30s).
   * Pass `0` (or any non-positive value) to disable.
   */
  timeoutMs?: number;
}

const DEFAULT_PROXY_TIMEOUT_MS = 30_000;

export class ProxyProvider implements LLMProvider, StreamingProvider {
  readonly name: string;
  private config: ProxyProviderConfig;

  constructor(config: ProxyProviderConfig) {
    this.config = config;
    this.name = config.name ?? 'proxy';
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    const body = this.config.buildBody
      ? this.config.buildBody(opts)
      : defaultBody(opts);

    // Compose abort signal: combine the caller's signal with our timeout
    // signal so either source can cancel.
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS;
    const timeoutCtrl = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => timeoutCtrl.abort(new Error('proxy timeout')), timeoutMs);
    }
    const onCallerAbort = () => timeoutCtrl.abort(opts.signal!.reason);
    if (opts.signal) {
      if (opts.signal.aborted) timeoutCtrl.abort(opts.signal.reason);
      else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      const response = await fetch(this.config.endpoint, {
        method: this.config.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.headers ?? {}),
        },
        credentials: this.config.credentials,
        body: JSON.stringify(body),
        signal: timeoutCtrl.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Proxy HTTP ${response.status}: ${text}`);
      }

      const raw = (await response.json()) as unknown;
      return this.config.parseResult ? this.config.parseResult(raw) : defaultParse(raw);
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort);
    }
  }

  /**
   * Streaming via the same endpoint. Default body shape (OpenAI-compatible)
   * is `{ messages, tools, ..., stream: true }`; the proxy is expected to
   * forward the SSE body verbatim. Hosts using a non-OpenAI wire shape
   * should override `buildBody` to inject their own streaming flag and
   * implement an OpenAI-style SSE on the backend (or use a separate
   * provider class).
   */
  streamComplete(opts: CompleteOptions): StreamHandle {
    const body = this.config.buildBody
      ? this.config.buildBody({ ...opts })
      : { ...defaultBody(opts), stream: true };

    const endpoint = this.config.endpoint;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.config.headers ?? {}),
    };
    const method = this.config.method ?? 'POST';
    const credentials = this.config.credentials;

    return buildStream({
      produce: () => streamProxy({ endpoint, method, headers, body, credentials, signal: opts.signal }),
    });
  }
}

async function* streamProxy(args: {
  endpoint: string;
  method: 'POST' | 'PUT';
  headers: Record<string, string>;
  body: unknown;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
}): AsyncIterable<{ delta?: string; toolCall?: ToolCall; finishReason?: CompleteResult['finishReason']; usage?: CompleteResult['usage'] }> {
  const response = await fetch(args.endpoint, {
    method: args.method,
    headers: args.headers,
    credentials: args.credentials,
    body: JSON.stringify(args.body),
    signal: args.signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Proxy HTTP ${response.status}: ${redactSecrets(text, [])}`);
  }
  if (!response.body) {
    throw new Error('Proxy: no response body for stream');
  }

  // Assume OpenAI-compatible SSE. Hosts that need a different wire shape
  // should implement their own streaming provider.
  const inflight = new Map<number, { id: string; name: string; argsBuf: string }>();
  const yielded = new Set<number>();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finishReason: CompleteResult['finishReason'] | undefined;

  while (true) {
    let value: Uint8Array | undefined;
    let done = false;
    try {
      const r = await reader.read();
      value = r.value;
      done = r.done;
    } catch (err) {
      // User-initiated abort — exit silently rather than bubbling an
      // AbortError up to the unhandled-rejection handler.
      if ((err as Error).name === 'AbortError') return;
      throw err;
    }
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      if (!event.trim()) continue;
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let parsed: ProxyStreamChunk;
        try { parsed = JSON.parse(payload) as ProxyStreamChunk; } catch { continue; }
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
          for (const [idx, entry] of inflight) {
            if (yielded.has(idx) || !entry.name) continue;
            yielded.add(idx);
            yield { toolCall: { id: entry.id, name: entry.name, arguments: safeParseJson(entry.argsBuf) ?? {} } };
          }
        }
      }
    }
  }
  if (finishReason) yield { finishReason };
}

function safeParseJson(s: string): Record<string, unknown> | null {
  if (!s) return {};
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

interface ProxyStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

// ─── default wire shapes ────────────────────────────────────────────

function defaultBody(opts: CompleteOptions): Record<string, unknown> {
  return {
    messages: opts.messages,
    tools: opts.tools,
    toolChoice: opts.toolChoice,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    model: opts.model,
    // Forward jsonMode so the backend can set `response_format:{type:'json_object'}`.
    // The webagent's cotMode (`agent_turn` structured envelope) relies on this —
    // without it weaker models free-form and emit an "invalid agent_turn envelope".
    jsonMode: opts.jsonMode,
  };
}

function defaultParse(raw: unknown): CompleteResult {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    return {
      content: typeof r.content === 'string' ? r.content : '',
      toolCalls: Array.isArray(r.toolCalls) ? (r.toolCalls as ToolCall[]) : undefined,
      usage: r.usage as CompleteResult['usage'],
      finishReason: (r.finishReason as CompleteResult['finishReason']) ?? 'stop',
    };
  }
  return { content: '', finishReason: 'stop' };
}
