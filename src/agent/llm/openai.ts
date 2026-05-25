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
import { redactSecrets } from '../../utils/redact';

export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  organization?: string;
  /** Default request headers (e.g. for self-hosted reverse proxies). */
  headers?: Record<string, string>;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  private apiKey: string;
  private model: string;
  private baseURL: string;
  private headers: Record<string, string>;

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
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    const model = opts.model ?? this.model;
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages.map(toOpenAIMessage),
    };

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
      // No custom temperature — reasoning models require the default.
      // Reasoning intensity → reasoning_effort param. 'off' maps to
      // 'minimal' (the lowest setting the API exposes).
      if (opts.thinking) {
        body.reasoning_effort = opts.thinking === 'off' ? 'minimal' : opts.thinking;
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
