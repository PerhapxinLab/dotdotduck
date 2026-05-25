/**
 * Cross-tab session sync helpers.
 *
 * The agent uses a BroadcastChannel keyed on `${sessionStorageKey}.crosstab`
 * to notify peer tabs (same origin) when its session updates, plus a
 * `localStorage` mirror so a tab opening fresh after a navigation can pick up
 * the latest session.
 *
 * Cross-origin / cross-subdomain is NOT possible from the browser sandbox —
 * see docs/12-session-continuity.md.
 */

import type { AgentSession } from './types';

export interface CrossTabBindings {
  /** Storage key for the BroadcastChannel + localStorage mirror. */
  crossTabKey: string;
  /** Latest known session ID (for echo suppression). */
  getCurrentSessionId(): string | undefined;
  /** True while a local agent loop is running — never overwrite mid-run. */
  isLocalRunActive(): boolean;
  /** Last `updatedAt` we've seen locally — used for monotonic ordering. */
  getLocalUpdatedAt(): number | undefined;
  /** Adopt a session received from another tab. */
  adoptSession(session: AgentSession): void;
}

/**
 * Open a BroadcastChannel + seed from localStorage. Returns the channel so
 * callers can `.close()` it on destroy. Returns null when BroadcastChannel
 * isn't available (jsdom without polyfill, very old browsers).
 */
export function setupCrossTabSync(bindings: CrossTabBindings): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(bindings.crossTabKey);
  } catch {
    return null;
  }

  channel.onmessage = (e: MessageEvent<AgentSession>) => {
    if (!e.data || e.data.id === bindings.getCurrentSessionId()) return;
    const localUpdated = bindings.getLocalUpdatedAt();
    // Adopt the newer session — never overwrite an in-flight local run.
    if (!bindings.isLocalRunActive() && (localUpdated === undefined || e.data.updatedAt > localUpdated)) {
      bindings.adoptSession(e.data);
    }
  };

  // Also seed from localStorage in case this tab opens fresh.
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(bindings.crossTabKey);
    if (raw) {
      try {
        const remote = JSON.parse(raw) as AgentSession;
        const localUpdated = bindings.getLocalUpdatedAt();
        if (remote && (localUpdated === undefined || remote.updatedAt > localUpdated)) {
          bindings.adoptSession(remote);
        }
      } catch {
        /* ignore corrupt entry */
      }
    }
  }

  return channel;
}

/** Broadcast the session to peer tabs and mirror it to localStorage. */
export function publishCrossTab(
  session: AgentSession,
  crossTabKey: string,
  channel: BroadcastChannel | null,
): void {
  channel?.postMessage(session);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(crossTabKey, JSON.stringify(session));
    } catch {
      /* quota or disabled — best effort */
    }
  }
}
