/**
 * LLM Adapter — uniform façade over a single vendor (OpenAI, Google,
 * self-hosted vLLM, custom backend, …). Hosts and dddk register adapters
 * once at boot, then construct `LLMProvider` instances by adapter id.
 *
 * The adapter interface is intentionally small: an `id` for the registry
 * key, an optional `matchesModel` for auto-detection callers (which model
 * id belongs to which vendor), and a `create()` factory that turns a
 * config bag into an `LLMProvider`.
 *
 * Config is a free-form bag because different vendors take different
 * fields (ProxyAdapter wants `endpoint` and `buildBody`; OpenAI wants
 * `apiKey` and `baseURL`; an Azure-OpenAI adapter would want a
 * `deployment` + `apiVersion`). Each adapter narrows the shape at
 * `create()` time.
 *
 * See `notes/llm-adapter-guide.md` § 7 for the design rationale and the
 * 12-step adapter-author checklist.
 */

import type { LLMProvider } from '../types';

export interface AdapterConfig {
  /** Vendor API key. Most adapters require it; proxy adapter doesn't. */
  apiKey?: string;
  /** Base URL — for swapping to a same-origin proxy, AI Gateway, or
   *  self-hosted endpoint. */
  baseURL?: string;
  /** Default model id when CompleteOptions.model is not set. */
  model?: string;
  /** Adapter-specific extras (e.g. proxy endpoint, custom headers). */
  [key: string]: unknown;
}

export interface LLMAdapter {
  /** Stable id used as the registry key and as the `provider` half of a
   *  `"<provider>:<model>"` spec string (e.g. `"openai:gpt-5.4-mini"`). */
  readonly id: string;
  /** Optional auto-detection: given a raw model id, does this adapter
   *  handle it? Used by routers that want to route a model id without
   *  a paired provider name. */
  matchesModel?(modelId: string): boolean;
  /** Build an `LLMProvider` instance from a config bag. */
  create(config: AdapterConfig): LLMProvider;
}
