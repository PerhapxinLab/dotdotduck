/**
 * LLMRouter — pick a provider per role.
 *
 * 4 roles:
 *   - `webagent` — main agent loop (text-only)
 *   - `vision`   — webagent with images / screenshot context. Falls back to webagent.
 *   - `utility`  — short single-shot calls (inline AI / voice cleanup / etc). Falls back to webagent.
 *   - `plan`     — pre-loop planner. Falls back to webagent.
 *
 * Legacy field names (`webagentWithSelection`, `inline`, `voiceCleanup`)
 * are still accepted as fallback sources so existing host configs keep
 * working; prefer the new names for new code.
 */

import type { LLMProvider } from './types';

export type LLMRole =
  | 'webagent'
  | 'vision'
  | 'utility'
  | 'plan'
  /** v0.2.0 · Wave 2·B. Conversational + tool-calling agent
   *  (TaskAgent). Defaults to `webagent` when not explicitly set on
   *  the router. */
  | 'task'
  /** @deprecated — alias for `vision`. */
  | 'webagentWithSelection'
  /** @deprecated — alias for `utility`. */
  | 'inline'
  /** @deprecated — alias for `utility`. */
  | 'voiceCleanup';

export interface LLMRouter {
  /** Required. Default LLM for the webagent loop. All other roles fall back here. */
  webagent: LLMProvider;
  /** Used when the agent has images / screenshots to reason about. */
  vision?: LLMProvider;
  /** Short single-shot calls — inline AI, voice cleanup, immersive translate. */
  utility?: LLMProvider;
  /** Pre-loop planner. */
  plan?: LLMProvider;
  /** v0.2.0 · Wave 2·B. TaskAgent — conversational + tool calling. */
  task?: LLMProvider;
  /** @deprecated — use `vision`. */
  webagentWithSelection?: LLMProvider;
  /** @deprecated — use `utility`. */
  inline?: LLMProvider;
  /** @deprecated — use `utility`. */
  voiceCleanup?: LLMProvider;
}

export type LLMSource = LLMProvider | LLMRouter;

export function isLLMRouter(v: LLMSource): v is LLMRouter {
  if (!v || typeof v !== 'object') return false;
  if (!('webagent' in v)) return false;
  const inner = (v as LLMRouter).webagent;
  return !!inner && typeof inner.complete === 'function';
}

export function resolveLLM(source: LLMSource, role: LLMRole): LLMProvider {
  if (!isLLMRouter(source)) return source;
  switch (role) {
    case 'webagent':
      return source.webagent;
    case 'vision':
    case 'webagentWithSelection':
      return source.vision ?? source.webagentWithSelection ?? source.webagent;
    case 'utility':
    case 'inline':
    case 'voiceCleanup':
      return source.utility ?? source.inline ?? source.voiceCleanup ?? source.webagent;
    case 'plan':
      return source.plan ?? source.webagent;
    case 'task':
      // TaskAgent prefers an explicit `task` provider, else the
      // utility tier (short single-shot LLM is similar billing
      // shape), else falls back to the main webagent model.
      return source.task ?? source.utility ?? source.inline ?? source.webagent;
  }
}
