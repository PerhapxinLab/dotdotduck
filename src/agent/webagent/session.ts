/**
 * Session persistence via sessionStorage — survives page navigations within same tab.
 */

import type { AgentSession } from './types';

export const DEFAULT_SESSION_KEY = 'webagent.session';

export function createSession(task: string, currentPage: string): AgentSession {
  return {
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    task,
    steps: [],
    status: 'idle',
    currentPage,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function loadSession(key: string = DEFAULT_SESSION_KEY): AgentSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as AgentSession;
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
    // Quota exceeded or storage disabled — silently ignore.
  }
}

export function clearSession(key: string = DEFAULT_SESSION_KEY): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
