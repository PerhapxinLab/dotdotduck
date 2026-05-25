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

export class ProxyProvider implements LLMProvider {
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
}

// ─── default wire shapes ────────────────────────────────────────────

function defaultBody(opts: CompleteOptions): Record<string, unknown> {
  return {
    messages: opts.messages,
    tools: opts.tools,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    model: opts.model,
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
