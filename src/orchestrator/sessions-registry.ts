/**
 * `dddk.sessions` — named session registry.
 *
 * Hosts wiring multiple agents (different personas per route, an
 * admin agent vs a docs agent, WebAgent + TaskAgent on the same
 * page) need a shared place to hold `AgentSession` objects so the
 * agents can read + append to the same conversation history. The
 * registry mediates: agents inject the session by reference, the
 * registry owns the lifecycle (create, reset, persist, clear).
 *
 * Persistence is OPT-IN per session via `persistKey` so the agent
 * pattern from v0.1 (one session, one localStorage key) keeps
 * working. Sessions without a `persistKey` live in memory only.
 *
 * v0.2.0 · Wave 2·A.
 */

import type { AgentSession } from '../agent/webagent/types';
import {
  createSession,
  loadSession,
  saveSession,
  clearSession as wipeSession,
} from '../agent/webagent/session';

export interface SessionRegistration {
  /** Identifier the host uses to reference this session. */
  name: string;
  /**
   * sessionStorage key for persistence. When set, the registry tries
   * `loadSession(persistKey)` on first `get()` and writes via
   * `saveSession(session, persistKey)` after `update()`. When unset,
   * the session lives in-memory for the page's lifetime.
   */
  persistKey?: string;
}

export class SessionsRegistry {
  private map = new Map<string, AgentSession>();
  /** Track persistKey per name so reset / clear can update storage. */
  private persistKeys = new Map<string, string>();

  /**
   * Fetch (or create-on-first-call) a named session. If `persistKey`
   * is provided AND a saved session exists under that key, it's
   * loaded once and cached; subsequent calls return the same in-memory
   * object so multiple agents share by reference.
   */
  get(name: string, opts: { persistKey?: string; currentPage?: string } = {}): AgentSession {
    const cached = this.map.get(name);
    if (cached) return cached;
    const persistKey = opts.persistKey;
    let session: AgentSession | null = null;
    if (persistKey) {
      session = loadSession(persistKey);
      this.persistKeys.set(name, persistKey);
    }
    if (!session) {
      const currentPage = opts.currentPage
        ?? (typeof location !== 'undefined' ? location.pathname + location.search : '/');
      session = createSession(currentPage);
    }
    this.map.set(name, session);
    return session;
  }

  /** True when the registry has a session under this name. */
  has(name: string): boolean {
    return this.map.has(name);
  }

  /** All registered session names. */
  list(): string[] {
    return Array.from(this.map.keys());
  }

  /**
   * Replace the session under `name` with a fresh one. All agents
   * holding a reference to the OLD session keep that reference —
   * they should call `dddk.sessions.get(name)` again to pick up the
   * new object. This is the "user explicitly started a new
   * conversation" path.
   */
  reset(name: string, opts: { currentPage?: string } = {}): AgentSession {
    const currentPage = opts.currentPage
      ?? (typeof location !== 'undefined' ? location.pathname + location.search : '/');
    const fresh = createSession(currentPage);
    this.map.set(name, fresh);
    const persistKey = this.persistKeys.get(name);
    if (persistKey) saveSession(fresh, persistKey);
    return fresh;
  }

  /** Persist the cached session under `name`. No-op for in-memory sessions. */
  persist(name: string): void {
    const persistKey = this.persistKeys.get(name);
    const session = this.map.get(name);
    if (persistKey && session) saveSession(session, persistKey);
  }

  /**
   * Remove the session from the registry. If it was persisted, also
   * wipes the underlying storage entry. Agents holding a reference
   * to the prior object see no change until they re-fetch via
   * `get(name)`.
   */
  clear(name: string): void {
    const persistKey = this.persistKeys.get(name);
    this.map.delete(name);
    this.persistKeys.delete(name);
    if (persistKey) wipeSession(persistKey);
  }

  /** Drop every session from the registry (memory + storage). */
  clearAll(): void {
    for (const name of this.list()) this.clear(name);
  }
}
