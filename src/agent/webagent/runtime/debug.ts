/**
 * `window.__dddkDebug` writes — single source of truth so test environments
 * (jsdom / SSR) can stub it once and there's no scattered `typeof window`
 * gates throughout loops.ts / messages.ts.
 */

import type { LLMMessage } from '../../llm/types';

interface DddkDebugWindow {
  __dddkDebug?: {
    lastParseFailure?: unknown;
    lastParseFailureAt?: string;
    turnLog?: unknown[];
    lastTurnResponse?: unknown;
    lastTurnAt?: string;
    lastLlmMessages?: unknown;
    lastLlmAt?: string;
  };
}

function getStore(): DddkDebugWindow['__dddkDebug'] | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as DddkDebugWindow;
  w.__dddkDebug = w.__dddkDebug ?? {};
  return w.__dddkDebug;
}

export function recordParseFail(rawArguments: unknown): void {
  const store = getStore();
  if (!store) return;
  store.lastParseFailure = rawArguments;
  store.lastParseFailureAt = new Date().toISOString();
}

export function recordTurn(summary: Record<string, unknown>, turn: unknown): void {
  const store = getStore();
  if (!store) return;
  store.turnLog = store.turnLog ?? [];
  store.turnLog.push(summary);
  // Cap log at 50 entries so long sessions don't bloat memory.
  if (store.turnLog.length > 50) {
    store.turnLog = store.turnLog.slice(-50);
  }
  store.lastTurnResponse = turn;
  store.lastTurnAt = new Date().toISOString();
}

export function recordMessages(messages: LLMMessage[]): void {
  const store = getStore();
  if (!store) return;
  store.lastLlmMessages = messages;
  store.lastLlmAt = new Date().toISOString();
}
