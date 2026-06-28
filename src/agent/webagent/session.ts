/**
 * Session persistence — sessionStorage backed, BroadcastChannel mirror for
 * cross-tab sync. The session is an append-only `turns[]` log; each
 * `agent.runStream()` call either creates a fresh one or appends a new
 * user turn to an existing one within the continuity window.
 */

import type { AgentSession, AgentTurn, UserTurn, AgentStepTurn, AgentFinalTurn } from './types';

export const DEFAULT_SESSION_KEY = 'webagent.session';

export function createSession(currentPage: string): AgentSession {
  const now = Date.now();
  return {
    id: `s_${now}_${Math.random().toString(36).slice(2, 8)}`,
    turns: [],
    status: 'idle',
    currentPage,
    startedAt: now,
    updatedAt: now,
  };
}

export function pushUserTurn(session: AgentSession, turn: Omit<UserTurn, 'kind' | 'ts'>): UserTurn {
  const full: UserTurn = { kind: 'user', ts: Date.now(), ...turn };
  session.turns.push(full);
  session.updatedAt = full.ts;
  return full;
}

export function pushAgentStep(session: AgentSession, turn: Omit<AgentStepTurn, 'kind' | 'ts'>): AgentStepTurn {
  const full: AgentStepTurn = { kind: 'agent_step', ts: Date.now(), ...turn };
  session.turns.push(full);
  session.updatedAt = full.ts;
  return full;
}

export function pushAgentFinal(session: AgentSession, text: string): AgentFinalTurn {
  const full: AgentFinalTurn = { kind: 'agent_final', ts: Date.now(), text };
  session.turns.push(full);
  session.updatedAt = full.ts;
  return full;
}

export function lastUserTurn(session: AgentSession): UserTurn | null {
  for (let i = session.turns.length - 1; i >= 0; i--) {
    const t = session.turns[i];
    if (t && t.kind === 'user') return t;
  }
  return null;
}

export function loadSession(key: string = DEFAULT_SESSION_KEY): AgentSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgentSession;
    if (!parsed || !Array.isArray(parsed.turns)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: AgentSession, key: string = DEFAULT_SESSION_KEY): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    session.updatedAt = Date.now();
    sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    /* quota / disabled */
  }
}

export function clearSession(key: string = DEFAULT_SESSION_KEY): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Decide whether a saved session is still "live" enough to pick up as
 * a follow-up. Returns true when:
 *   - status is not terminal (done / failed)
 *   - status === running ('thinking'/'executing'/'navigating'/'waiting')
 *     OR last update is within continuityMs
 */
export function isSessionLive(session: AgentSession, continuityMs: number): boolean {
  // Explicit reload (F5 / Ctrl+R / Ctrl+Shift+R) means the user
  // wants a clean slate. Stored sessions surviving a reload feel
  // haunted — the agent claims to "remember" attempts from a tab
  // the user manually reset. Treat reload as the boundary that ends
  // session continuity, full stop. Cross-PAGE-navigation continuity
  // (SPA route change) still works because that's not a reload.
  if (isReloadNavigation()) return false;
  if (session.status === 'thinking' || session.status === 'executing' || session.status === 'navigating' || session.status === 'waiting') {
    return true;
  }
  if (session.status === 'idle' && continuityMs > 0) {
    return Date.now() - session.updatedAt <= continuityMs;
  }
  return false;
}

/**
 * Was the current page entered via reload? Cached on first call —
 * `performance.getEntriesByType('navigation')` returns the same
 * record for the lifetime of the document. Returns false for SSR /
 * environments without performance API.
 */
let _isReloadCache: boolean | null = null;
function isReloadNavigation(): boolean {
  if (_isReloadCache !== null) return _isReloadCache;
  if (typeof performance === 'undefined' || !performance.getEntriesByType) {
    _isReloadCache = false;
    return false;
  }
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    _isReloadCache = nav?.type === 'reload';
  } catch {
    _isReloadCache = false;
  }
  return _isReloadCache;
}

/**
 * Detect whether the agent should auto-resume — true when status was
 * `executing` / `navigating` (interrupted by a SPA route change) and
 * the current URL differs from the session's recorded `currentPage`.
 */
export function shouldAutoResume(session: AgentSession, currentPath: string): boolean {
  if (session.status !== 'navigating' && session.status !== 'executing' && session.status !== 'thinking') {
    return false;
  }
  return session.currentPage !== currentPath;
}

export type { AgentTurn };
