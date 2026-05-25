/**
 * Google provider — talks to Google AI Studio (`generativelanguage.googleapis.com`).
 * Supports both Gemini (gemini-3.1-pro-preview, gemini-2.5-pro, ...) and
 * Gemma (gemma-4-31b-it, ...) — the endpoint shape is the same; only the
 * model id differs. Translates messages / tools to / from OpenAI-shape internally.
 */

import type {
  LLMProvider,
  CompleteOptions,
  CompleteResult,
  ToolCall,
} from '../types';
import { buildStream, type StreamHandle, type StreamingProvider } from '../stream';
import { redactSecrets } from '../../../utils/redact';
import { toGeminiMessages, mapFinishReason } from './transform';
import { streamGemini, buildThinkingConfig } from './stream';

export interface GoogleProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export class GoogleProvider implements LLMProvider, StreamingProvider {
  readonly name = 'google';

  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor(config: GoogleProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gemini-3.1-pro-preview';
    this.baseURL = config.baseURL ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    const model = opts.model ?? this.model;
    // Pass the key in a header instead of the URL query string — query
    // strings leak into proxy access logs, browser history, and referrer
    // headers on subsequent navigations.
    const url = `${this.baseURL}/models/${model}:generateContent`;

    const { contents, systemInstruction } = toGeminiMessages(opts.messages);

    const generationConfig: Record<string, unknown> = {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens,
    };
    // Thinking config — see buildThinkingConfig for the per-family field
    // mapping (thinkingLevel vs. thinkingBudget) and which models reject
    // which field. When opts.thinking is undefined we deliberately do not
    // inject a default — the caller is responsible for choosing the right
    // level for their workload (translation / voice cleanup → 'off';
    // agent loop → omit to use the model's dynamic default).
    const thinkingPayload = buildThinkingConfig(model, opts.thinking);
    if (thinkingPayload) generationConfig.thinkingConfig = thinkingPayload;
    if (opts.jsonMode) {
      generationConfig.responseMimeType = 'application/json';
    }
    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (systemInstruction) body.systemInstruction = systemInstruction;

    if (opts.tools && opts.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    // generativelanguage.googleapis.com occasionally returns transient
    // 500/502/503 INTERNAL errors. Retry up to three times with
    // exponential backoff (700 / 1500 / 2800 ms) plus jitter so we
    // survive brief upstream blips without surfacing them as agent
    // failures. 429 is handled at the proxy layer with its own
    // pool/cooldown, so we don't retry on it here.
    const fetchOnce = () => fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    const backoffs = [700, 1500, 2800];
    let response = await fetchOnce();
    for (const base of backoffs) {
      if (response.ok) break;
      if (response.status < 500 || response.status >= 600) break;
      // Drain failed body so the connection can be reused.
      try { await response.text(); } catch { /* noop */ }
      const jitter = Math.random() * 250;
      await new Promise((r) => setTimeout(r, base + jitter));
      response = await fetchOnce();
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Gemini HTTP ${response.status}: ${redactSecrets(errText, [this.apiKey])}`,
      );
    }

    const data = (await response.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('Gemini: no candidates returned');

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const part of candidate.content?.parts ?? []) {
      // Gemma 4 emits reasoning as `{ text, thought: true }` parts even
      // at thinkingLevel=MINIMAL. Drop them so the model's chain-of-thought
      // never leaks into translated/JSON output.
      if (part.thought === true) continue;
      if (part.text) content += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${toolCalls.length}_${Date.now()}`,
          name: part.functionCall.name,
          arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
          }
        : undefined,
      finishReason: mapFinishReason(candidate.finishReason),
    };
  }

  /**
   * Streaming via Gemini's :streamGenerateContent endpoint (alt=sse).
   */
  streamComplete(opts: CompleteOptions): StreamHandle {
    const apiKey = this.apiKey;
    const model = opts.model ?? this.model;
    const baseURL = this.baseURL;

    return buildStream({
      produce: () => streamGemini({ apiKey, model, baseURL, opts }),
    });
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts: Array<{
        text?: string;
        thought?: boolean;
        functionCall?: { name: string; args?: unknown };
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}
