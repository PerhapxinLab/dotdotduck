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

/**
 * Surface presentation — agent emits a PieceSurface (image+text card,
 * option group, etc.) and waits for the user to pick or cancel. The
 * host renders into a PlacementSlot and resolves with the chosen
 * option's value (or null on cancel).
 *
 * Only fires when the host has opted in via `WebAgentConfig.allowPresent`
 * AND has wired the surface mounter via `setSurfaceMounter`.
 */
export interface PresentSurfacePayload {
  /** Piece tree the host renders. The agent built it; the host trusts
   *  its catalog won't include unsafe pieces (Slot's `render` fn etc.). */
  surface: unknown;
  /** Where on screen to render. Subset of PlacementSlot — agent isn't
   *  given access to fab / banner / toast since those have semantics
   *  the agent shouldn't be allowed to choose. */
  placement: 'subtitle' | 'modal' | 'dock' | 'inline';
  /** Resolves with the chosen option's value, or null on cancel. */
  resolve: (pick: { value: string | null; cancelled: boolean }) => void;
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
  /** Surface a structured PieceSurface to the host. Returns the user's
   *  pick (or cancellation). `undefined` here means the host hasn't
   *  wired the mounter — `present_surface` then fails fast with a
   *  clear `reason: 'unknown'` so the model knows to fall back to
   *  manual narration. */
  emitPresentSurface?: (payload: PresentSurfacePayload) => void;
  /** Stable-ID → element map from the latest readDOM. Action handlers
   *  resolve `[id]` style selectors via this map so the LLM doesn't have
   *  to invent CSS selectors. IDs are short alphanumeric hashes (e.g.
   *  `e4f3a`) — they stay stable across turns for the same element. */
  indexMap: Map<string, Element>;
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
      if (typeof target === 'number') {
        // Legacy numeric path — keep working for old sessions persisted
        // before the hash-ID change; new sessions never call with number.
        return bindings.indexMap.get(String(target)) ?? null;
      }
      if (typeof target === 'string') {
        const trimmed = target.trim();
        // Stable-ID path — `[e4f3a]`, `e4f3a`, or with a viewport marker
        // (`↓[e4f3a]`). Also accepts legacy numeric refs (`"5"`) for
        // session-replay compatibility, though the new DOM dump never
        // emits those.
        const m = /^[↑↓]?\s*\[?([A-Za-z0-9_-]+)\]?$/.exec(trimmed);
        if (m) {
          const id = m[1]!;
          const el = bindings.indexMap.get(id);
          if (el) return el;
          // Fall through — id didn't match, try as CSS selector.
        }
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
    const question = String(params.question ?? '');
    const answer = await new Promise<string>((resolve) => {
      bindings.registerPendingResolver(resolve);
      bindings.emitAskUser({ question, resolve });
    });
    return { ok: true, data: { question, answer } };
  }

  if (name === 'pause') {
    // Narrator's mid-narrative beat. Own envelope (not ask_user) so the
    // host can render it as a "space to continue" hint on the streaming
    // bar instead of replacing the bar with a prompt.
    const llmNote = typeof params.note === 'string' && params.note ? params.note : null;
    const hint = llmNote ?? bindings.defaultPauseNote ?? SDK_DEFAULT_PAUSE_NOTE;
    const answer = await new Promise<string>((resolve) => {
      bindings.registerPendingResolver(resolve);
      bindings.emitPause({ hint, resolve });
    });
    return { ok: true, data: { hint, answer } };
  }

  if (name === 'ask_user_choice') {
    const rawOptions = Array.isArray(params.options) ? params.options : [];
    const options = rawOptions.map((o) => String(o));
    const question = String(params.question ?? '');
    const allowFreeText = params.allowFreeText !== false;
    const answer = await new Promise<string>((resolve) => {
      bindings.registerPendingResolver(resolve);
      bindings.emitAskUserChoice({ question, options, allowFreeText, resolve });
    });
    const source: 'option' | 'free_text' | 'cancelled' =
      answer === '' ? 'cancelled'
        : options.includes(answer) ? 'option'
        : 'free_text';
    return { ok: true, data: { question, options, answer, source } };
  }

  if (name === 'present_surface') {
    // Intercepted here so the action runtime can route a PieceSurface to
    // the host's mounter and await the user's pick. The host wires the
    // mounter via `WebAgent.setSurfaceMounter`; without that wire, we
    // fail fast so the model falls back to manual narration / ask_user.
    if (!bindings.emitPresentSurface) {
      return {
        ok: false,
        reason: 'unknown',
        message: 'present_surface requires the host to wire a surface mounter (WebAgent.setSurfaceMounter). Falling back: narrate the options manually or use ask_user_choice.',
      };
    }
    const surface = params.surface;
    if (!surface || typeof surface !== 'object') {
      return { ok: false, reason: 'unknown', message: 'present_surface requires a `surface` object (a PieceSurface tree).' };
    }
    const placement = (typeof params.placement === 'string'
      ? params.placement
      : 'subtitle') as 'subtitle' | 'modal' | 'dock' | 'inline';
    const surfaceObj = surface as Record<string, unknown>;
    const surfaceId = typeof surfaceObj.id === 'string' ? surfaceObj.id
      : typeof surfaceObj.kind === 'string' ? surfaceObj.kind
      : 'surface';
    const result = await new Promise<{ value: string | null; cancelled: boolean }>((resolve) => {
      bindings.registerPendingResolver((raw) => {
        try { resolve(JSON.parse(raw)); } catch { resolve({ value: null, cancelled: true }); }
      });
      bindings.emitPresentSurface!({
        surface,
        placement,
        resolve: (pick) => resolve(pick),
      });
    });
    return {
      ok: true,
      data: {
        surface_id: surfaceId,
        placement,
        answer: result.value,
        cancelled: result.cancelled,
      },
    };
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
