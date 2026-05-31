/**
 * Types shared across the Plan module — todos artifact, markdown artifact,
 * planning input/output. The shape is deliberately conservative: every
 * artifact is in-memory by default; hosts that want persistence wire a
 * storage adapter (`{ load, save }`) at construction time.
 */

import type { SitemapConfig, SelectionContext } from '../webagent/types';
import type { BrandPrompt, PersonaInput } from '../webagent/prompt';

/**
 * A single planned step. The webagent reads this list as its master plan
 * for the run; `replace` / `remove` mutations happen via the per-turn
 * envelope, not the artifact API (so the LLM cannot mutate it freely from
 * arbitrary tool calls).
 */
export interface TodoItem {
  /** Stable id assigned by Plan on create — `t1`, `t2`, ... */
  id: string;
  /**
   * Coarse classification of what this todo does. The webagent loop uses
   * this hint to know whether a turn should be a navigate-only turn vs a
   * narrate turn. Non-exhaustive — hosts can introduce custom intents.
   */
  intent: 'navigate' | 'narrate' | 'click' | 'fill' | 'ask' | 'finish' | string;
  /** Human-readable description — what the user will perceive happen. */
  description: string;
  /**
   * Predicted turn index this todo will land on, starting at 1. Lets the
   * webagent recognise when the plan and reality diverge (a navigate todo
   * planned for turn 1 should be the only action of turn 1).
   */
  expected_turn?: number;
}

/** Output of one planning call. `task_summary` is shown to the user when
 *  `announcePlan` is on; `todos` is the master list the loop executes. */
export interface TaskPlan {
  task_summary: string;
  todos: TodoItem[];
}

/** What the planner needs to know to write a good plan. */
export interface PlanInput {
  /** The user's original task text. */
  task: string;
  /** Optional sitemap so the planner knows which pages exist. */
  sitemap?: SitemapConfig;
  /** Optional brand context (productName / voice / constraints). */
  brand?: BrandPrompt;
  /** Optional persona so plan task_summary speaks in the right voice. */
  persona?: PersonaInput;
  /** BCP-47 locale hint for `task_summary` language. */
  locale?: string;
  /** User selection (Dwell / drag) at invocation time. */
  selection?: SelectionContext;
  /** Free-form host context (recent history, current page, etc). */
  hostContext?: string;
}

/** An in-memory markdown document. Not used by the webagent — exposed for
 *  hosts that want LLM-mediated authoring of meeting notes, drafts, etc. */
export interface MarkdownDoc {
  /** Stable id assigned by Plan on create — `m1`, `m2`, ... */
  id: string;
  title: string;
  content: string;
  /** ms epoch — set on create + every edit. */
  updatedAt: number;
}

/**
 * Optional storage adapter. Same shape as ImmersiveTranslate's cache —
 * `load()` runs once at construct time and seeds in-memory state;
 * `save()` runs after every mutation. Hosts can plug IndexedDB,
 * localStorage, or a server endpoint behind this interface.
 */
export interface PlanStorageAdapter {
  load(): Promise<PlanSnapshot | null> | PlanSnapshot | null;
  save(snapshot: PlanSnapshot): Promise<void> | void;
}

export interface PlanSnapshot {
  todos: TodoItem[];
  markdownDocs: MarkdownDoc[];
}
