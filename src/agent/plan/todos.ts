/**
 * Todos artifact — in-memory CRUD for `TodoItem`s. Owned by a `Plan`
 * instance; the webagent reads the list to drive the loop and mutates
 * via the per-turn envelope's `todo_adjust` field (not by calling these
 * methods directly — runtime translates envelope ops to these calls).
 *
 * Mutations bump `version` and call the optional `onChange` hook so
 * persistence + UI subscribers can react. ids are short stable strings
 * (`t1`, `t2`, ...) — predictable so model output can reference them.
 */

import type { TodoItem } from './types';

export interface TodosArtifactOptions {
  /** Optional change hook. Fires after every mutation with the new list. */
  onChange?: (items: TodoItem[]) => void;
  /** Seed items — used when restoring from a storage adapter. */
  initial?: TodoItem[];
  /** ID counter seed — used when restoring from a storage adapter. */
  initialIdCounter?: number;
}

export class TodosArtifact {
  private items: TodoItem[] = [];
  private idCounter: number;
  private readonly onChange?: (items: TodoItem[]) => void;

  constructor(opts: TodosArtifactOptions = {}) {
    this.onChange = opts.onChange;
    this.items = [...(opts.initial ?? [])];
    this.idCounter = opts.initialIdCounter ?? this.items.length;
  }

  /** Returns a defensive copy so mutations don't leak. */
  list(): TodoItem[] {
    return this.items.map((t) => ({ ...t }));
  }

  get(id: string): TodoItem | null {
    const found = this.items.find((t) => t.id === id);
    return found ? { ...found } : null;
  }

  /** Create one item, returning the assigned id. */
  create(item: Omit<TodoItem, 'id'>): TodoItem {
    const id = `t${++this.idCounter}`;
    const next: TodoItem = { id, ...item };
    this.items.push(next);
    this.notify();
    return { ...next };
  }

  /** Bulk-create — used by `Plan.makeTodos()` after a planning call. */
  createMany(items: Array<Omit<TodoItem, 'id'>>): TodoItem[] {
    const created = items.map((it) => {
      const id = `t${++this.idCounter}`;
      const next: TodoItem = { id, ...it };
      this.items.push(next);
      return { ...next };
    });
    this.notify();
    return created;
  }

  /** Partial update — id-preserving. Returns the new item or null if id
   *  not found. The webagent uses this for `todo_adjust.replace`. */
  edit(id: string, patch: Partial<Omit<TodoItem, 'id'>>): TodoItem | null {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const next: TodoItem = { ...this.items[idx]!, ...patch };
    this.items[idx] = next;
    this.notify();
    return { ...next };
  }

  /** Drop one item by id. Returns true if removed, false if not found. */
  delete(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.id !== id);
    const removed = this.items.length < before;
    if (removed) this.notify();
    return removed;
  }

  /** Replace the entire list — used when a fresh `Plan.makeTodos()` is
   *  triggered mid-session and the host wants a hard reset. */
  reset(items: TodoItem[] = []): void {
    this.items = items.map((t) => ({ ...t }));
    this.idCounter = items.length;
    this.notify();
  }

  /** For storage adapter — id counter must survive reload so future
   *  `create()` calls don't collide with pre-existing ids. */
  serialize(): { items: TodoItem[]; idCounter: number } {
    return {
      items: this.items.map((t) => ({ ...t })),
      idCounter: this.idCounter,
    };
  }

  private notify(): void {
    if (this.onChange) this.onChange(this.list());
  }
}
