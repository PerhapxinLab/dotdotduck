/**
 * Google adapter — wraps `GoogleProvider`, covering both Gemini and Gemma
 * model families (both go through `generativelanguage.googleapis.com`).
 * `matchesModel` recognises `gemini-*` and `gemma-*` model ids.
 *
 * Model-family quirks are normalised inside `GoogleProvider.complete()`
 * via `buildThinkingConfig` — Gemini 3.x / Gemma 4 use `thinkingLevel`,
 * Gemini 2.5 uses `thinkingBudget`, and `part.thought === true` parts
 * are stripped from responses so reasoning never leaks.
 */

import { GoogleProvider, type GoogleProviderConfig } from '../google';
import type { LLMAdapter, AdapterConfig } from './types';

export const googleAdapter: LLMAdapter = {
  id: 'google',
  matchesModel(modelId: string): boolean {
    return /^(gemini-|gemma-)/i.test(modelId);
  },
  create(config: AdapterConfig) {
    const cfg: GoogleProviderConfig = {
      apiKey: String(config.apiKey ?? ''),
      model: config.model as string | undefined,
      baseURL: config.baseURL as string | undefined,
    };
    return new GoogleProvider(cfg);
  },
};
