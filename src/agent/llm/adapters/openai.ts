/**
 * OpenAI adapter — wraps `OpenAIProvider`.
 *
 * `matchesModel` returns true for OpenAI's first-party model families
 * (`gpt-*`, `o1`/`o3`/..., `text-*`). Routers that detect by model id
 * use this as the dispatch test.
 *
 * Vendor quirks (see `notes/llm-adapter-guide.md` § 3 for full table):
 *   - gpt-5+ (incl. `-mini`/`-nano`) require `max_completion_tokens`,
 *     NOT `max_tokens`.
 *   - True reasoning models (o-series, gpt-5+ full non-mini) reject
 *     custom `temperature`.
 *   - `-mini` / `-nano` accept both temperature AND `max_completion_tokens`.
 * These are all handled inside `OpenAIProvider.complete()`.
 */

import { OpenAIProvider, type OpenAIProviderConfig } from '../openai';
import type { LLMAdapter, AdapterConfig } from './types';

export const openaiAdapter: LLMAdapter = {
  id: 'openai',
  matchesModel(modelId: string): boolean {
    return /^(gpt-|o[1-9]|text-)/i.test(modelId);
  },
  create(config: AdapterConfig) {
    const cfg: OpenAIProviderConfig = {
      apiKey: String(config.apiKey ?? ''),
      model: config.model as string | undefined,
      baseURL: config.baseURL as string | undefined,
      organization: config.organization as string | undefined,
      headers: config.headers as Record<string, string> | undefined,
    };
    return new OpenAIProvider(cfg);
  },
};
