/**
 * InlineAgent scope registry.
 *
 * A "scope" is a per-region override of the root InlineAgent config: a
 * different action set, a different LLM, a different system prompt, a
 * different menu layout. Hosts attach scopes by CSS selector; when the
 * user makes a selection inside a matching element, the InlineAgent
 * resolves the innermost matching scope and uses its config instead of
 * the root config.
 *
 * Resolution flow per selection:
 *   1. If the host set a `scopeResolver` callback AND it returns a
 *      non-null config, that config wins (callback bypass).
 *   2. Else walk UP from the selection's anchor element. The FIRST
 *      ancestor that matches any registered selector is the innermost
 *      scope — its config wins.
 *   3. If nothing matches, the root config applies as before.
 *
 * Live registry — `attachScope` / `setScopeResolver` may be called at
 * any time. The next selection sees the new registration; an in-flight
 * menu doesn't change underneath the user.
 */

import type { ActionDefinition } from '../webagent/types';
import type { LLMSource } from '../llm/router';
// Type-only import — TS erases this at runtime so the index ↔ scoping
// cycle is purely a dependency-graph artifact, not a real module cycle.
import type { InlineAction } from './index';

/**
 * Per-scope override. Every field is optional — what the scope doesn't
 * set inherits from the root InlineAgent config.
 */
export interface InlineScopeConfig {
  /**
   * Replace the action set for selections inside this scope. When set,
   * the root's actions are NOT included — use `appendActions` instead
   * if you want to extend rather than replace.
   */
  actions?: InlineAction[];
  /**
   * Append these actions AFTER the root actions (or after `actions`
   * if this scope also sets that). Stacks cleanly with `disabledActions`
   * for "root actions minus some, plus my new ones".
   */
  appendActions?: InlineAction[];
  /**
   * Drop root actions by id. Only meaningful when this scope doesn't
   * set its own `actions` (because that already replaces the root set).
   */
  disabledActions?: string[];
  /** Override the LLM used for runs initiated from this scope. */
  llm?: LLMSource;
  /**
   * Replace the system prompt for runs from this scope. Use
   * `appendSystemPrompt` if you want to keep the base prompt and add
   * a tone / domain hint.
   */
  systemPrompt?: string;
  /**
   * Append text to the base system prompt. The base is whatever was
   * effective WITHOUT the scope — either root's `systemPrompt` or the
   * SDK default if root didn't set one. Combined: `${base}\n\n${append}`.
   */
  appendSystemPrompt?: string;
  /** Override menu layout (single-column / two-column / toolbar). */
  layout?: 'single-column' | 'two-column' | 'toolbar';
  /** Override two-column header labels. */
  columnLabels?: { col1?: string; col2?: string };
  /** Override translate-target language list. */
  translateTargets?: Array<{ code: string; label: string }>;
  /**
   * Override the tool-call layer. Setting this enables a tool-call
   * loop for this scope even if the root has no tools; pass empty
   * array to explicitly disable tools for this scope.
   */
  tools?: ActionDefinition[];
}

/** Handle returned by `attachScope`; lets the host unregister later. */
export interface ScopeHandle {
  /** Remove this scope from the registry. Idempotent. */
  remove(): void;
}

/**
 * Callback fallback for cases CSS selectors can't express (e.g.
 * "selections longer than 1000 chars use the long-form scope" or
 * "any element inside a Shadow DOM uses the shadow scope"). Return
 * `null` to fall through to selector matching.
 */
export type ScopeResolver = (selection: {
  text: string;
  element: HTMLElement;
}) => InlineScopeConfig | null;

/** Internal — what `attachScope` stores in the registry. */
export interface ScopeEntry {
  id: string;
  selector: string;
  config: InlineScopeConfig;
}

/**
 * Resolve which scope (if any) applies to a selection anchored at
 * `element`. Returns the scope's config or `null` if no scope matches.
 *
 * Walk semantics: starts at `element` and walks UP through ancestors.
 * The FIRST ancestor that matches any registered selector wins —
 * that's the innermost scope by definition. Ties at the same DOM
 * depth are broken by registration order (earlier registration wins,
 * which matches the host's mental model of "first wired first").
 */
export function resolveInlineScope(
  element: HTMLElement,
  scopes: readonly ScopeEntry[],
  resolver: ScopeResolver | undefined,
  selectionText: string,
): InlineScopeConfig | null {
  // Callback bypass takes precedence — host knows things selectors can't.
  if (resolver) {
    const cb = resolver({ text: selectionText, element });
    if (cb) return cb;
  }
  if (scopes.length === 0) return null;
  // Walk up. The closest ancestor that matches any selector is the
  // innermost scope — selector-based resolution.
  let cur: HTMLElement | null = element;
  while (cur) {
    for (const scope of scopes) {
      try {
        if (cur.matches(scope.selector)) return scope.config;
      } catch {
        // Invalid selector — skip, don't crash the selection flow.
      }
    }
    cur = cur.parentElement;
  }
  return null;
}
