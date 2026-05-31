/**
 * LLMRouter — pick a provider per role. Lets you mix OpenAI + Gemini and
 * use different models for different jobs (cheap model for short tasks,
 * smart model for the main agent).
 *
 * Pass either a single LLMProvider (same model everywhere — simplest) or
 * an LLMRouter (one provider per role).
 *
 * Roles fall back to `webagent` if not set, so you only have to declare
 * what you want to override.
 */

import type { LLMProvider } from './types';

export type LLMRole =
  /** Main webagent loop, no selection context. */
  | 'webagent'
  /** Webagent loop when the user had something selected on open. Falls back to `webagent`. */
  | 'webagentWithSelection'
  /** Inline AI (input-field editing, short single-shot LLM calls). Falls back to `webagent`. */
  | 'inline'
  /** Voice transcript cleanup (remove fillers, fix punctuation). Falls back to `webagent`. */
  | 'voiceCleanup'
  /** Plan module — one-shot planning calls + markdown LLM edits. Falls back to `webagent`. */
  | 'plan';

export interface LLMRouter {
  /** Required. Default LLM for the webagent loop. All other roles fall back here. */
  webagent: LLMProvider;
  /** Optional. Cheaper model when webagent runs with selection context. */
  webagentWithSelection?: LLMProvider;
  /** Optional. Small/fast model for inline AI (input-field rewrite, translate, etc). */
  inline?: LLMProvider;
  /** Optional. Tiny model for voice transcript cleanup. */
  voiceCleanup?: LLMProvider;
  /** Optional. Planning-stage model — runs once per agent run before the
   *  turn loop. Can be the same as `webagent` (default) or a larger model
   *  if planning quality matters more than per-turn cost. */
  plan?: LLMProvider;
}

export type LLMSource = LLMProvider | LLMRouter;

export function isLLMRouter(v: LLMSource): v is LLMRouter {
  // Multi-field duck-type: a LLMRouter must be a plain object with a
  // `webagent` member that is itself an LLMProvider (has `.complete`). This
  // is more robust than a single negative check on `complete` — an
  // LLMProvider implemented via subclass / proxy where `complete` is
  // attached to the prototype rather than the instance would otherwise be
  // misclassified.
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
    case 'webagentWithSelection':
      return source.webagentWithSelection ?? source.webagent;
    case 'inline':
      return source.inline ?? source.webagent;
    case 'voiceCleanup':
      return source.voiceCleanup ?? source.webagent;
    case 'plan':
      return source.plan ?? source.webagent;
  }
}
