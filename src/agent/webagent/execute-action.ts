/**
 * Action execution — runs an action handler with the right side effects.
 *
 * Two built-ins handled here intercept the registry to yield user
 * interaction back to the host:
 *   - `ask_user`        — free-text question
 *   - `ask_user_choice` — picker
 *
 * `navigate` is also special-cased: the action handler itself only
 * returns metadata (the path); the agent runtime emits a `navigated`
 * event and the host's router moves the page. This file is the right
 * place to wire that bridge.
 */

import type {
  ActionDefinition,
  ActionResult,
  ActionContext,
  AgentSession,
} from './types';

export interface AskUserPayload {
  question: string;
  resolve: (answer: string) => void;
}

export interface AskUserChoicePayload {
  question: string;
  options: string[];
  allowFreeText: boolean;
  resolve: (answer: string) => void;
}

/**
 * `pause` is its own envelope (NOT an ask_user) so hosts can render it
 * differently — typically by attaching a "press space to continue"
 * hint to the running streaming subtitle bar, rather than replacing
 * the bar with a confirmation dialog. The text the agent just streamed
 * must stay visible while the user reads.
 */
export interface PausePayload {
  hint: string;
  resolve: (answer: string) => void;
}

export interface ExecuteActionBindings {
  actions: Map<string, ActionDefinition>;
  /** Register a host-interaction resolver and return its id. */
  registerPendingResolver(resolver: (raw: string) => void): string;
  /** Surface a free-text question to the host. */
  emitAskUser(payload: AskUserPayload): void;
  /** Surface a multi-choice picker to the host. */
  emitAskUserChoice(payload: AskUserChoicePayload): void;
  /** Surface a narrator-controlled mid-stream pause. The host typically
   *  attaches a "press space to continue" hint INSIDE the streaming
   *  subtitle bar rather than spawning a separate prompt — so the
   *  text the agent just streamed stays visible while the user reads. */
  emitPause(payload: PausePayload): void;
  /** Index → element map from the latest readDOM. Action handlers
   *  resolve `[N]` style selectors via this map so the LLM doesn't have
   *  to invent CSS selectors. */
  indexMap: Map<number, Element>;
  session: AgentSession;
  /** Subtitle-bar fallback shown when the `pause` tool is called with
   *  no `note`. Hosts pass their own string here for a localised UX;
   *  the LLM can still override per-call via the tool's `note` arg. */
  defaultPauseNote?: string;
}

export async function executeAction(
  bindings: ExecuteActionBindings,
  name: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionResult> {
  const action = bindings.actions.get(name);
  if (!action) {
    return { ok: false, reason: 'unknown', message: `Unknown action: ${name}` };
  }

  const ctx: ActionContext = {
    session: bindings.session,
    signal,
    resolveTarget: (target: string | number): Element | null => {
      // Numeric index path — `3`, `"3"`, or `"[3]"` all resolve via
      // the per-turn indexMap.
      if (typeof target === 'number') {
        return bindings.indexMap.get(target) ?? null;
      }
      if (typeof target === 'string') {
        const trimmed = target.trim();
        // Accept the bare number (`"5"`), bracketed (`"[5]"`), or with
        // a leading viewport marker the dump emits (`"↓[5]"` / `"↑5"`).
        const m = /^[↑↓]?\s*\[?(\d+)\]?$/.exec(trimmed);
        if (m) {
          const idx = parseInt(m[1]!, 10);
          const el = bindings.indexMap.get(idx);
          if (el) return el;
          // Fall through — index didn't match, try as CSS selector.
        }
        // CSS selector path — passed verbatim to querySelector.
        if (typeof document !== 'undefined') {
          try {
            return document.querySelector(trimmed);
          } catch {
            return null;
          }
        }
      }
      return null;
    },
  };

  if (name === 'ask_user') {
    const answer = await new Promise<string>((resolve) => {
      bindings.registerPendingResolver(resolve);
      bindings.emitAskUser({ question: String(params.question ?? ''), resolve });
    });
    return { ok: true, data: answer };
  }

  if (name === 'pause') {
    // Narrator-controlled mid-narrative beat. Uses its OWN envelope
    // (not ask_user) so hosts can render it differently — typically by
    // attaching a "press space to continue" hint INSIDE the existing
    // streaming subtitle bar instead of replacing the bar with a
    // standalone prompt.
    const llmNote = typeof params.note === 'string' && params.note ? params.note : null;
    const hint = llmNote ?? bindings.defaultPauseNote ?? SDK_DEFAULT_PAUSE_NOTE;
    const answer = await new Promise<string>((resolve) => {
      bindings.registerPendingResolver(resolve);
      bindings.emitPause({ hint, resolve });
    });
    return { ok: true, data: answer };
  }

  if (name === 'ask_user_choice') {
    const rawOptions = Array.isArray(params.options) ? params.options : [];
    const options = rawOptions.map((o) => String(o));
    const allowFreeText = params.allowFreeText !== false;
    const answer = await new Promise<string>((resolve) => {
      bindings.registerPendingResolver(resolve);
      bindings.emitAskUserChoice({
        question: String(params.question ?? ''),
        options,
        allowFreeText,
        resolve,
      });
    });
    return { ok: true, data: answer };
  }

  try {
    return await action.handler(params, ctx);
  } catch (err) {
    return { ok: false, reason: 'unknown', message: (err as Error).message };
  }
}

/** SDK-default fallback used when neither the LLM nor the host provided
 *  pause-bar copy. English-only by design — hosts override via
 *  `WebAgentConfig.defaultPauseNote` for a localised UX. */
const SDK_DEFAULT_PAUSE_NOTE = 'Press space to continue';
