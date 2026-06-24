/**
 * Agnes AI adapter — wraps `OpenAIProvider` against Agnes AI's
 * OpenAI-compatible gateway.
 *
 * Agnes AI (https://agnes-ai.com) exposes a vLLM-backed, OpenAI-compatible
 * API at `https://apihub.agnes-ai.com/v1`: standard `/chat/completions`
 * (blocking + SSE streaming), `/models`, `/images/generations`, Bearer
 * auth. Responses carry extra `provider_specific_fields` keys which the
 * OpenAI parser ignores, and may omit the `data: [DONE]` SSE sentinel
 * (the empty-`choices` usage chunk marks the end) — both handled by
 * `OpenAIProvider`'s tolerant stream reader.
 *
 * The free tier is capped at ~20 RPM on a shared key, so the canonical
 * deployment proxies through a backend (dddk-frontend `/api/llm/agnes/v1`)
 * that injects the real key and throttles — same `proxied-via-worker`
 * dummy-key pattern as the other vendors. Direct use (passing a real
 * `apiKey`) works too for local testing.
 *
 * Verified live 2026-06-23 via curl: base URL, bearer auth, model list
 * (`agnes-2.0-flash` for chat), blocking + streaming all confirmed.
 */

import { OpenAIProvider, type OpenAIProviderConfig } from '../openai';
import type { LLMAdapter, AdapterConfig } from './types';

/** Agnes AI default gateway (OpenAI-compatible). */
export const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
/** Default chat/coding/tool-calling model. */
export const AGNES_DEFAULT_MODEL = 'agnes-2.0-flash';

export const agnesAdapter: LLMAdapter = {
  id: 'agnes',
  matchesModel(modelId: string): boolean {
    return /^agnes-/i.test(modelId);
  },
  create(config: AdapterConfig) {
    const cfg: OpenAIProviderConfig = {
      apiKey: String(config.apiKey ?? ''),
      model: (config.model as string | undefined) ?? AGNES_DEFAULT_MODEL,
      baseURL: (config.baseURL as string | undefined) ?? AGNES_BASE_URL,
      headers: config.headers as Record<string, string> | undefined,
      extraBody: config.extraBody as Record<string, unknown> | undefined,
    };
    return new OpenAIProvider(cfg);
  },
};
