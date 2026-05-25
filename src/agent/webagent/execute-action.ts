/**
 * Action execution — looks up an action by name and runs it through the
 * registry. The built-in `ask_user` and `ask_user_choice` actions yield
 * control back to the host and pause the loop until `respond()` resolves
 * the pending promise.
 *
 * Extracted from WebAgent.ts to keep that file focused on lifecycle + loop.
 */

import type {
  ActionDefinition,
  ActionResult,
  ActionContext,
} from './types';

export interface ExecuteActionBindings {
  actions: Map<string, ActionDefinition>;
  /** Register a host-interaction resolver and return its id. */
  registerPendingResolver(resolver: (raw: string) => void): string;
  /** Emit an event from the agent's typed emitter. */
  emit: ActionContext['emit'];
  /** Set the agent status (waiting / executing). */
  setStatus(status: 'waiting'): void;
  /** Current session (asserted non-null when executeAction is called). */
  session: ActionContext['session'];
  /**
   * True when the agent runs in interactive (step-by-step) mode. In this
   * mode `show_subtitle` becomes a "narrate and wait" action — the agent
   * can tell the user what it just did or what's next, and the user
   * presses Space (continue) before the loop moves on.
   */
  interactive: boolean;
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
    emit: bindings.emit,
  };

  // Built-in action: ask_user — pauses agent until host calls respond().
  if (name === 'ask_user') {
    bindings.setStatus('waiting');
    const answer = await new Promise<string>((resolve) => {
      bindings.registerPendingResolver(resolve);
      bindings.emit('ask_user', { question: String(params.question ?? ''), resolve });
    });
    return { ok: true, data: answer };
  }

  // Built-in action: ask_user_choice — like ask_user but the host renders
  // a discrete option picker. Mirrors Claude Code's AskUserQuestion shape
  // (2-4 options + optional Other free-text). Pauses agent until the host
  // calls respond() with the chosen value (the canonical option string for
  // a listed pick, OR the user's typed string for a free-text answer).
  // Built-in action: show_subtitle. In interactive mode this becomes a
  // "narrate and wait" gesture — the agent surfaces a status / progress
  // message and the loop pauses until the user presses Space (continue)
  // or double-taps Space / Esc (stop). The host wires the same
  // accept/reject pathway it uses for ask_user so a single muscle
  // memory drives the whole step-by-step flow. In auto mode show_subtitle
  // fires the subtitle and returns immediately (no pause).
  if (name === 'show_subtitle') {
    bindings.emit('subtitle', String(params.text ?? ''));
    if (!bindings.interactive) {
      return { ok: true };
    }
    // Pause until host calls `respond()`. Any string answer is treated
    // as "continue" — host's accept gesture fires respond('continue').
    bindings.setStatus('waiting');
    const answer = await new Promise<string>((resolve) => {
      bindings.registerPendingResolver(resolve);
      // Reuse ask_user envelope so the orchestrator already knows how
      // to gate this on Space accept. Question is the same text the
      // user just saw — host's renderer can choose to skip re-rendering.
      bindings.emit('ask_user', {
        question: String(params.text ?? ''),
        resolve,
      });
    });
    return { ok: true, data: answer };
  }

  if (name === 'ask_user_choice') {
    bindings.setStatus('waiting');
    const rawOptions = Array.isArray(params.options) ? params.options : [];
    const options = rawOptions.map((o) => String(o));
    const allowFreeText = params.allowFreeText !== false;
    const answer = await new Promise<string>((resolve) => {
      bindings.registerPendingResolver(resolve);
      bindings.emit('ask_user_choice', {
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
