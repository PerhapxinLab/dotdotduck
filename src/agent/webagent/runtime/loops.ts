/**
 * The two top-level loops: classic single-tool and CoT envelope.
 *
 * Both consume the WebAgent instance through its `@internal` surface
 * (sessionRef / configRef / actionsRef / ...) so the main class file
 * stays focused on constructor + public API + state.
 */

import type { WebAgent } from '../webagent';
import type { AgentEvent, ActionResult } from '../types';
import type { ToolCall } from '../../llm/types';
import {
  pushAgentStep,
  pushAgentFinal,
  lastUserTurn,
} from '../session';
import { executeAction } from '../execute-action';
import {
  AGENT_TURN_TOOL,
  parseTurnResponse,
  isNarrateAction,
  isToolAction,
} from '../cot';
import { sdkString } from '../../../utils/sdk-i18n';
import {
  awaitNavSettle,
  extractTargetSelector,
  isUserEditingInPalette,
  narrateAction,
  sleep,
} from './helpers';
import { recordParseFail, recordTurn } from './debug';
import { callLlmStream } from './messages';

/**
 * Look for a visible <a href> whose target matches `path`. Used by the
 * `preferClickLinkOverNavigate` config flag — when the host opts in we
 * trigger this anchor's `.click()` instead of calling the navigate bridge
 * directly, so demos look like a real human clicking nav.
 *
 * Matches an anchor when either:
 *   - href equals path exactly (`/dashboard`)
 *   - href equals path with trailing slash trimmed
 *   - the anchor's `pathname` matches path (handles fully-qualified hrefs)
 *
 * Skips disabled / `aria-disabled` / hidden anchors. Returns the first
 * match in document order — usually the primary nav link.
 */
function findNavLink(path: string): HTMLAnchorElement | null {
  if (typeof document === 'undefined' || !path) return null;
  const want = path.replace(/\/$/, '') || '/';
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
  for (const a of Array.from(anchors)) {
    if (a.getAttribute('aria-disabled') === 'true') continue;
    if (a.hasAttribute('disabled')) continue;
    if (!(a.offsetParent || a.getClientRects().length > 0)) continue; // not visible
    const raw = a.getAttribute('href') ?? '';
    const trimmed = raw.replace(/\/$/, '') || '/';
    if (trimmed === want) return a;
    try {
      const u = new URL(a.href, location.origin);
      const pn = u.pathname.replace(/\/$/, '') || '/';
      if (pn === want) return a;
    } catch { /* ignore malformed hrefs */ }
  }
  return null;
}

export async function* executeLoop(
  agent: WebAgent,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  const session = agent.sessionRef;
  if (!session) return;
  let errorCount = 0;

  for (let stepIdx = 0; stepIdx < agent.configRef.maxSteps; stepIdx++) {
    if (signal.aborted) {
      agent.setStatusInternal('idle');
      return;
    }

    // SPA nav detection between iterations.
    const nowUrl = typeof location !== 'undefined' ? location.pathname + location.search : null;
    if (nowUrl && session.currentPage !== nowUrl) {
      const from = session.currentPage;
      session.currentPage = nowUrl;
      agent.persistSessionInternal();
      yield { kind: 'navigated', from, to: nowUrl };
    }

    agent.setStatusInternal('thinking');
    yield { kind: 'thinking' };

    let toolCall: ToolCall | undefined;
    let textBuffer = '';
    try {
      for await (const ev of callLlmStream(agent, signal)) {
        if (signal.aborted) { agent.setStatusInternal('idle'); return; }
        if (ev.kind === 'text-delta' && ev.delta) {
          textBuffer += ev.delta;
          yield ev;
        } else if (ev.kind === 'tool-call') {
          toolCall = ev.call;
          // Let the stream finish so finishReason / usage land; no more
          // text deltas matter once the tool is known.
        }
      }
      errorCount = 0;
    } catch (err) {
      if (signal.aborted) { agent.setStatusInternal('idle'); return; }
      errorCount += 1;
      const retrying = errorCount < agent.configRef.maxErrors;
      yield { kind: 'error', error: err as Error, retrying };
      if (!retrying) {
        agent.setStatusInternal('failed');
        return;
      }
      await sleep(400 * Math.pow(2, errorCount - 1));
      continue;
    }

    // No tool call → final paragraph. Done.
    if (!toolCall) {
      if (textBuffer) pushAgentFinal(session, textBuffer);
      agent.setStatusInternal('idle');
      yield { kind: 'final' };
      return;
    }

    const matched = agent.actionsRef.get(toolCall.name);

    const needsConfirm = await agent.needsConfirmationInternal(toolCall, matched, signal);
    if (needsConfirm) {
      const locale = agent.configRef.locale ?? 'en';
      // Precedence: per-action override → host-level override → SDK default.
      const message = matched?.confirmationMessage?.(toolCall.arguments as never)
        ?? agent.configRef.buildConfirmMessage?.(toolCall.name, toolCall.arguments, locale)
        ?? narrateAction(toolCall.name, toolCall.arguments, locale);
      let resolveConfirm!: (ok: boolean) => void;
      const approvedPromise = new Promise<boolean>((r) => { resolveConfirm = r; });
      agent.setStatusInternal('waiting');
      yield {
        kind: 'confirm',
        actionName: toolCall.name,
        args: toolCall.arguments,
        message,
        decide: resolveConfirm,
      };
      const approved = await Promise.race([
        approvedPromise,
        new Promise<boolean>((_, reject) => {
          const onAbort = (): void => { signal.removeEventListener('abort', onAbort); reject(new Error('aborted')); };
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]).catch(() => false);
      if (!approved) {
        const result: ActionResult = { ok: false, reason: 'user_declined' };
        pushAgentStep(session, {
          preText: textBuffer || undefined,
          toolCall: { name: toolCall.name, arguments: toolCall.arguments },
          toolCallId: toolCall.id,
          result,
        });
        agent.persistSessionInternal();
        yield { kind: 'tool-end', name: toolCall.name, result, toolCallId: toolCall.id };
        continue;
      }
    }

    const targetSelector = extractTargetSelector(toolCall.arguments);
    yield {
      kind: 'tool-start',
      name: toolCall.name,
      args: toolCall.arguments,
      targetSelector,
      toolCallId: toolCall.id,
    };

    let result: ActionResult;
    if (toolCall.name === 'navigate') {
      agent.setStatusInternal('navigating');
      const path = String(toolCall.arguments.path ?? '');
      const from = session.currentPage;
      // Surface the loading beat BEFORE the router fires so the host can
      // show a loading indicator until `navigated` arrives.
      yield { kind: 'navigating', from, to: path };

      // v0.2.0 ROADMAP — preferClickLinkOverNavigate.
      // When the host opts in, look for a visible <a href="${path}"> on
      // the page and trigger it like a user click (with the synthetic
      // cursor if cursorTrail is also on). This keeps demos looking like
      // a human navigating instead of a history.pushState ghost. Falls
      // through to the standard bridge when no matching link exists.
      let linkClicked = false;
      if (agent.configRef.preferClickLinkOverNavigate && typeof document !== 'undefined') {
        const anchor = findNavLink(path);
        if (anchor) {
          try {
            if (agent.configRef.cursorTrail) {
              const { moveCursorAndTap } = await import('../cursor');
              await moveCursorAndTap(anchor);
            }
            anchor.click();
            linkClicked = true;
            await new Promise((r) => setTimeout(r, 80));
          } catch {
            linkClicked = false;
          }
        }
      }
      try {
        if (!linkClicked) {
          const bridgeResult = agent.navigateBridgeRef?.(path);
          // Hosts whose router returns a Promise: await for the real
          // "render complete" signal before declaring nav done.
          if (bridgeResult && typeof (bridgeResult as Promise<void>).then === 'function') {
            await bridgeResult;
          }
        }
      } catch (err) {
        result = { ok: false, reason: 'navigation', message: (err as Error).message };
        yield { kind: 'tool-end', name: 'navigate', result, toolCallId: toolCall.id };
        pushAgentStep(session, {
          preText: textBuffer || undefined,
          toolCall: { name: toolCall.name, arguments: toolCall.arguments },
          toolCallId: toolCall.id,
          result,
        });
        agent.persistSessionInternal();
        continue;
      }
      // Stabilisation — components may still be hydrating / lazy chunks
      // fetching even after the router resolves. Idle-watch with 250ms
      // quiet window, 2.5s ceiling.
      await awaitNavSettle(2500);
      yield { kind: 'navigated', from, to: path };
      // Continuation hint in the tool result so the next LLM turn sees,
      // in the tool message itself, that arrival isn't the end. Without
      // this, smaller models often emit finish_reason=stop right after
      // navigate succeeds.
      result = {
        ok: true,
        data: {
          path,
          arrivedAt: path,
          note: 'Navigation complete — you are NOW at this URL. The user\'s original task is not done yet; the navigate was a means to an end. Continue immediately: read the new page DOM in the next message, pick the first subject in reading order, border it, narrate 1-3 sentences quoting the actual visible text, then call pause. Do NOT stop the loop here.',
        },
      };
    } else {
      const wasUserFacing = toolCall.name === 'ask_user' || toolCall.name === 'ask_user_choice';
      agent.setStatusInternal(wasUserFacing ? 'waiting' : 'executing');
      result = await executeAction(
        {
          actions: agent.actionsRef,
          indexMap: agent.currentIndexMap,
          registerPendingResolver: (r) => agent.registerPendingResolverInternal(r),
          emitAskUser: (payload) => {
            if (agent.askUserHandlerRef) agent.askUserHandlerRef(payload);
            else payload.resolve('');
          },
          emitAskUserChoice: (payload) => {
            if (agent.askUserChoiceHandlerRef) agent.askUserChoiceHandlerRef(payload);
            else payload.resolve('');
          },
          emitPause: (payload) => {
            if (agent.pauseHandlerRef) agent.pauseHandlerRef(payload);
            // Fallback: ask_user envelope so the gesture still works
            // when the host hasn't wired setPauseHandler.
            else if (agent.askUserHandlerRef) {
              agent.askUserHandlerRef({ question: payload.hint, resolve: payload.resolve });
            } else {
              payload.resolve('');
            }
          },
          emitPresentSurface: agent.surfaceMounterRef
            ? (payload) => agent.surfaceMounterRef!(payload)
            : undefined,
          session,
          defaultPauseNote:
            agent.configRef.defaultPauseNote ?? sdkString(agent.configRef.locale, 'agent.press_space_continue'),
          uiHints: {
            cursorTrail: agent.configRef.cursorTrail,
            preferClickLinkOverNavigate: agent.configRef.preferClickLinkOverNavigate,
          },
        },
        toolCall.name,
        toolCall.arguments,
        signal,
      );
    }

    yield { kind: 'tool-end', name: toolCall.name, result, toolCallId: toolCall.id };

    pushAgentStep(session, {
      preText: textBuffer || undefined,
      toolCall: { name: toolCall.name, arguments: toolCall.arguments },
      toolCallId: toolCall.id,
      result,
    });
    agent.persistSessionInternal();

    if (!result.ok) {
      errorCount += 1;
      if (errorCount >= agent.configRef.maxErrors) {
        agent.setStatusInternal('failed');
        return;
      }
    } else {
      errorCount = 0;
    }
  }

  // maxSteps hit. Yield `final` so the orchestrator's closure hook still
  // renders the closing UI (otherwise the subtitle bar just disappears,
  // which reads as broken).
  agent.setStatusInternal('failed');
  yield { kind: 'final' };
}

/**
 * One-shot planning call run before the CoT turn loop. Resulting TaskPlan
 * is stored on session.plan so subsequent turns render `# Master plan`
 * in the system prompt and mutate via todo_adjust. Fail-loud — a thrown
 * error propagates to the consumer's runStream() iterator.
 *
 * Returns `true` if the loop should continue, `false` to abort.
 */
export async function* executePlanningPhase(
  agent: WebAgent,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent, boolean, void> {
  const session = agent.sessionRef!;
  if (!agent.configRef.planner || session.plan) return true;

  agent.setStatusInternal('thinking');
  yield { kind: 'thinking' };
  const latestUser = lastUserTurn(session);
  const taskText = latestUser?.text ?? '';
  console.info('[dddk webagent] planning start', { task: taskText });
  try {
    const plan = await agent.configRef.planner({
      task: taskText,
      sitemap: agent.configRef.sitemap,
      brand: agent.configRef.brand,
      persona: agent.configRef.persona,
      locale: agent.configRef.locale,
      selection: agent.currentSelectionRef ?? undefined,
    });
    session.plan = plan;
    agent.persistSessionInternal();
    console.info('[dddk webagent] planning result', {
      task_summary: plan.task_summary,
      todoCount: plan.todos.length,
      todos: plan.todos,
    });
    if (agent.configRef.announcePlan && plan.task_summary?.trim()) {
      yield {
        kind: 'text-delta',
        delta: plan.task_summary.trim() + '\n',
      };
      // Wait for user ack before turn 1 — otherwise the first turn's
      // confirm dialog covers the announce before the user can read it.
      if (agent.pauseHandlerRef) {
        agent.setStatusInternal('waiting');
        const pauseHint = sdkString(agent.configRef.locale, 'agent.press_space_continue');
        const resolution = await new Promise<string>((resolve) => {
          agent.pauseHandlerRef!({ hint: pauseHint, resolve });
        });
        if (signal.aborted || resolution === '') {
          agent.setStatusInternal('idle');
          return false;
        }
      }
    }
    return true;
  } catch (err) {
    if (signal.aborted) { agent.setStatusInternal('idle'); return false; }
    console.warn('[dddk webagent] planning failed', err);
    yield { kind: 'error', error: err as Error, retrying: false };
    agent.setStatusInternal('failed');
    return false;
  }
}

export async function* executeCotLoop(
  agent: WebAgent,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  const session = agent.sessionRef;
  if (!session) return;

  const planContinue = yield* executePlanningPhase(agent, signal);
  if (!planContinue) return;

  let errorCount = 0;

  // Reaction-requiring tools whose result the model MUST observe before
  // the run can finish. If is_final lands in the same turn as any of
  // these, we drop is_final (the run isn't actually done yet).
  const TOOLS_REQUIRING_NEXT_REACTION = new Set(['ask_user_choice', 'ask_user', 'navigate']);

  for (let stepIdx = 0; stepIdx < agent.configRef.maxSteps; stepIdx++) {
    if (signal.aborted) { agent.setStatusInternal('idle'); return; }

    // SPA nav detection between iterations.
    const nowUrl = typeof location !== 'undefined' ? location.pathname + location.search : null;
    if (nowUrl && session.currentPage !== nowUrl) {
      const from = session.currentPage;
      session.currentPage = nowUrl;
      agent.persistSessionInternal();
      yield { kind: 'navigated', from, to: nowUrl };
    }

    agent.setStatusInternal('thinking');
    yield { kind: 'thinking' };

    // Single forced tool call to `agent_turn`. Stray text deltas are
    // ignored (schema doesn't allow them; we tolerate misbehaving providers).
    let agentTurnCall: ToolCall | undefined;
    try {
      for await (const ev of callLlmStream(agent, signal)) {
        if (signal.aborted) { agent.setStatusInternal('idle'); return; }
        if (ev.kind === 'tool-call' && ev.call.name === AGENT_TURN_TOOL) {
          agentTurnCall = ev.call;
        }
      }
      errorCount = 0;
    } catch (err) {
      if (signal.aborted) { agent.setStatusInternal('idle'); return; }
      errorCount += 1;
      const retrying = errorCount < agent.configRef.maxErrors;
      yield { kind: 'error', error: err as Error, retrying };
      if (!retrying) { agent.setStatusInternal('failed'); return; }
      await sleep(400 * Math.pow(2, errorCount - 1));
      continue;
    }

    if (!agentTurnCall) {
      // Provider didn't comply with toolChoice — treat as done so the
      // user isn't stuck in an empty loop.
      agent.setStatusInternal('idle');
      yield { kind: 'final' };
      return;
    }

    const turn = parseTurnResponse(agentTurnCall.arguments);
    if (!turn) {
      errorCount += 1;
      const result: ActionResult = { ok: false, reason: 'unknown', message: 'invalid agent_turn envelope' };
      console.warn('[dddk webagent] turn parse failed', {
        rawArguments: agentTurnCall.arguments,
      });
      recordParseFail(agentTurnCall.arguments);
      pushAgentStep(session, {
        toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
        toolCallId: agentTurnCall.id,
        result,
      });
      agent.persistSessionInternal();
      yield { kind: 'tool-end', name: AGENT_TURN_TOOL, result, toolCallId: agentTurnCall.id };
      if (errorCount >= agent.configRef.maxErrors) { agent.setStatusInternal('failed'); return; }
      continue;
    }

    // Per-turn debug log. Legacy mode has `todos_remaining`; planned mode
    // has `turn_planning` + `todo_adjust` + the live master `plan.todos`.
    // Omit `undefined` placeholders so the log shows only populated fields.
    const turnSummary: Record<string, unknown> = {
      turn: stepIdx + 1,
      url: session.currentPage,
      memory: turn.memory,
    };
    if (turn.todos_remaining !== undefined) turnSummary.todos_remaining = turn.todos_remaining;
    if (turn.turn_planning) turnSummary.turn_planning = turn.turn_planning;
    if (turn.todo_adjust) turnSummary.todo_adjust = turn.todo_adjust;
    if (session.plan) {
      turnSummary.master_todos = session.plan.todos.map((t) => `${t.id}:${t.intent}:${t.description}`);
    }
    turnSummary.actions = turn.actions.map((a) => {
      if (isNarrateAction(a)) {
        return { narrate: a.narrate.length > 100 ? a.narrate.slice(0, 100) + '…' : a.narrate };
      }
      return { tool: (a as { tool: string }).tool, args: (a as { args?: unknown }).args };
    });
    if (turn.is_final) turnSummary.is_final = true;
    console.info('[dddk webagent] turn', turnSummary);
    recordTurn(turnSummary, turn);

    // Apply todo_adjust mutations BEFORE dispatching actions — adjustments
    // describe what the PREVIOUS turn completed / how the plan morphs based
    // on observed reality.
    if (turn.todo_adjust && session.plan) {
      if (turn.todo_adjust.remove?.length) {
        for (const id of turn.todo_adjust.remove) {
          session.plan.todos = session.plan.todos.filter((t) => t.id !== id);
        }
      }
      if (turn.todo_adjust.replace?.length) {
        for (const r of turn.todo_adjust.replace) {
          const idx = session.plan.todos.findIndex((t) => t.id === r.id);
          if (idx < 0) continue;
          session.plan.todos[idx] = {
            ...session.plan.todos[idx]!,
            description: r.new_description,
            ...(r.new_intent ? { intent: r.new_intent } : {}),
          };
        }
      }
      agent.persistSessionInternal();
    }

    // In legacy mode `todos_remaining` carries the plan; planned mode has
    // it absent (master plan lives on session.plan.todos, mutates via
    // todo_adjust). Normalise away orphan tool calls only in legacy mode
    // and only when the model emitted NEITHER an explicit task_finish NOR
    // any narrate — i.e. it left orphan tool calls without a closing signal.
    if (turn.todos_remaining !== undefined && turn.todos_remaining.length === 0 && turn.actions.length > 0) {
      const hasNarrate = turn.actions.some((a) => isNarrateAction(a));
      if (!turn.is_final && !hasNarrate) {
        if (typeof console !== 'undefined') {
          console.info('[dddk webagent] todos empty + actions has only tools without is_final → ' + turn.actions.length + ' queued actions normalized away; loop ends');
        }
        turn.actions = [];
      }
    }

    if (turn.actions.length === 0) {
      // Empty actions[] = task complete. Record the envelope so history
      // replays cleanly.
      pushAgentStep(session, {
        toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
        toolCallId: agentTurnCall.id,
        result: {
          ok: true,
          data: {
            memory: turn.memory,
            todos_remaining: turn.todos_remaining,
            action_count: 0,
            action_results: [],
          },
        },
      });
      agent.persistSessionInternal();
      agent.setStatusInternal('idle');
      yield { kind: 'final' };
      return;
    }

    // Iterate actions in order. Per-action outcomes go into actionResults
    // so the next LLM turn can read what actually happened.
    const actionResults: Array<
      { type: 'narrate'; text: string }
      | { type: 'tool'; name: string; ok: boolean; reason?: string; data?: unknown }
      | { type: 'done' }
    > = [];
    let actionErrorThisTurn = 0;
    let pageChanged = false;
    let endLoopRequested = false;
    let executedReactionRequiringTool = false;

    for (let ai = 0; ai < turn.actions.length; ai++) {
      const action = turn.actions[ai]!;
      if (signal.aborted) { agent.setStatusInternal('idle'); return; }

      if (isNarrateAction(action)) {
        agent.setStatusInternal('executing');
        // Auto-border the element this narrate is "about" BEFORE streaming
        // the text. Bundling framing into the narrate payload prevents the
        // model from forgetting to chain a separate border action — it's
        // structurally enforced rather than rule-enforced. Synthesises the
        // same tool-start / tool-end events the explicit border path emits
        // so highlight pipelines still observe the framing.
        const about = (action as { about?: string }).about;
        if (about && about.trim().length > 0) {
          const borderAction = agent.actionsRef.get('border');
          if (borderAction) {
            const synthId = `cot_about_${stepIdx}_${ai}_${Math.random().toString(36).slice(2, 6)}`;
            yield {
              kind: 'tool-start',
              name: 'border',
              args: { selector: about },
              targetSelector: about,
              toolCallId: synthId,
            };
            const borderResult = await executeAction(
              {
                actions: agent.actionsRef,
                indexMap: agent.currentIndexMap,
                registerPendingResolver: (r) => agent.registerPendingResolverInternal(r),
                emitAskUser: () => {},
                emitAskUserChoice: () => {},
                emitPause: () => {},
                emitPresentSurface: undefined,
                session,
                defaultPauseNote: '',
              },
              'border',
              { selector: about },
              signal,
            );
            yield { kind: 'tool-end', name: 'border', result: borderResult, toolCallId: synthId };
            actionResults.push({
              type: 'tool',
              name: 'border',
              ok: borderResult.ok,
              reason: borderResult.ok ? undefined : borderResult.reason,
              data: borderResult.ok ? borderResult.data : undefined,
            });
          }
        }

        // Throttled typewriter: agent_turn arrives complete, so slice and
        // pace out. 4ms/char ≈ 250 chars/sec; chunking 2 chars/tick keeps
        // event-loop overhead low at that rate.
        const NARRATE_CHUNK_SIZE = 2;
        const NARRATE_CHUNK_DELAY_MS = 8;
        for (let i = 0; i < action.narrate.length; i += NARRATE_CHUNK_SIZE) {
          if (signal.aborted) { agent.setStatusInternal('idle'); return; }
          yield { kind: 'text-delta', delta: action.narrate.slice(i, i + NARRATE_CHUNK_SIZE) };
          await sleep(NARRATE_CHUNK_DELAY_MS);
        }
        actionResults.push({ type: 'narrate', text: action.narrate });

        // Auto-pause after every narration. Runtime inserts the pause so
        // the model never has to manage cadence with explicit `pause`
        // tool calls. Don't skip on the next action being confirm-required
        // (navigate / destructive): the confirm dialog would cover the
        // narrate the user is still reading. Pause first, ack narrate
        // context, THEN show the confirm.
        //
        // One skip condition: focus inside the open palette's input.
        // Palette is the one place where "user typing INTO SDK surface
        // while agent is running" is explicit, persistent state.
        let skipPause = false;
        if (isUserEditingInPalette()) {
          skipPause = true;
        }
        // v0.2.0 ROADMAP 1.5: host can disable the runtime-level
        // auto-pause entirely. Distinct from putting `'pause'` in
        // `excludeTools` (which only hides the tool from the LLM).
        if (agent.configRef.disableAutoPauseAfterNarrate === true) {
          skipPause = true;
        }

        if (!skipPause && agent.pauseHandlerRef) {
          agent.setStatusInternal('waiting');
          const pauseHint = sdkString(agent.configRef.locale, 'agent.press_space_continue');
          const resolution = await new Promise<string>((resolve) => {
            agent.pauseHandlerRef!({ hint: pauseHint, resolve });
          });
          if (signal.aborted || resolution === '') {
            agent.setStatusInternal('idle');
            return;
          }
        }
        continue;
      }

      if (isToolAction(action)) {
        // Synthesise a ToolCall and route through the same confirm-gate +
        // dispatch path the classic loop uses.
        const synth: ToolCall = {
          id: `cot_${stepIdx}_${Math.random().toString(36).slice(2, 8)}`,
          name: action.tool,
          arguments: action.args ?? {},
        };
        if (TOOLS_REQUIRING_NEXT_REACTION.has(synth.name)) {
          executedReactionRequiringTool = true;
        }
        const matched = agent.actionsRef.get(synth.name);

        const needsConfirm = await agent.needsConfirmationInternal(synth, matched, signal);
        if (needsConfirm) {
          const locale = agent.configRef.locale ?? 'en';
          const message = matched?.confirmationMessage?.(synth.arguments as never)
            ?? agent.configRef.buildConfirmMessage?.(synth.name, synth.arguments, locale)
            ?? narrateAction(synth.name, synth.arguments, locale);
          let resolveConfirm!: (ok: boolean) => void;
          const approvedPromise = new Promise<boolean>((r) => { resolveConfirm = r; });
          agent.setStatusInternal('waiting');
          yield {
            kind: 'confirm',
            actionName: synth.name,
            args: synth.arguments,
            message,
            decide: resolveConfirm,
          };
          const approved = await Promise.race([
            approvedPromise,
            new Promise<boolean>((_, reject) => {
              const onAbort = (): void => { signal.removeEventListener('abort', onAbort); reject(new Error('aborted')); };
              signal.addEventListener('abort', onAbort, { once: true });
            }),
          ]).catch(() => false);
          if (!approved) {
            const result: ActionResult = { ok: false, reason: 'user_declined' };
            yield { kind: 'tool-end', name: synth.name, result, toolCallId: synth.id };
            actionResults.push({ type: 'tool', name: synth.name, ok: false, reason: 'user_declined' });
            continue;
          }
        }

        const targetSelector = extractTargetSelector(synth.arguments);
        yield { kind: 'tool-start', name: synth.name, args: synth.arguments, targetSelector, toolCallId: synth.id };

        let result: ActionResult;
        if (synth.name === 'navigate') {
          const path = String(synth.arguments.path ?? '').trim();
          if (!path) {
            // Reject loudly so the next turn sees the failure in history
            // and self-corrects, rather than the bridge silently no-op'ing
            // and the user staring at a hung confirm.
            result = { ok: false, reason: 'unknown', message: 'navigate requires a non-empty `path` arg (e.g. "/docs")' };
            yield { kind: 'tool-end', name: 'navigate', result, toolCallId: synth.id };
            actionResults.push({ type: 'tool', name: 'navigate', ok: false, reason: 'missing path' });
            actionErrorThisTurn += 1;
            continue;
          }
          agent.setStatusInternal('navigating');
          const from = session.currentPage;
          yield { kind: 'navigating', from, to: path };
          try {
            const bridgeResult = agent.navigateBridgeRef?.(path);
            if (bridgeResult && typeof (bridgeResult as Promise<void>).then === 'function') {
              await bridgeResult;
            }
          } catch (err) {
            result = { ok: false, reason: 'navigation', message: (err as Error).message };
            yield { kind: 'tool-end', name: 'navigate', result, toolCallId: synth.id };
            actionResults.push({ type: 'tool', name: synth.name, ok: false, reason: 'navigation' });
            actionErrorThisTurn += 1;
            continue;
          }
          await awaitNavSettle(2500);
          yield { kind: 'navigated', from, to: path };
          result = { ok: true, data: { path, arrivedAt: path } };
          // Remaining actions in this envelope were planned against the
          // OLD DOM and would mis-target. Break the action loop below
          // and let the next outer iteration re-read DOM + re-plan.
          pageChanged = true;
        } else {
          const wasUserFacing = synth.name === 'ask_user' || synth.name === 'ask_user_choice';
          agent.setStatusInternal(wasUserFacing ? 'waiting' : 'executing');
          result = await executeAction(
            {
              actions: agent.actionsRef,
              indexMap: agent.currentIndexMap,
              registerPendingResolver: (r) => agent.registerPendingResolverInternal(r),
              emitAskUser: (payload) => {
                if (agent.askUserHandlerRef) agent.askUserHandlerRef(payload);
                else payload.resolve('');
              },
              emitAskUserChoice: (payload) => {
                if (agent.askUserChoiceHandlerRef) agent.askUserChoiceHandlerRef(payload);
                else payload.resolve('');
              },
              emitPause: (payload) => {
                if (agent.pauseHandlerRef) agent.pauseHandlerRef(payload);
                else if (agent.askUserHandlerRef) {
                  agent.askUserHandlerRef({ question: payload.hint, resolve: payload.resolve });
                } else {
                  payload.resolve('');
                }
              },
              emitPresentSurface: agent.surfaceMounterRef
                ? (payload) => agent.surfaceMounterRef!(payload)
                : undefined,
              session,
              defaultPauseNote:
                agent.configRef.defaultPauseNote ?? sdkString(agent.configRef.locale, 'agent.press_space_continue'),
            },
            synth.name,
            synth.arguments,
            signal,
          );
        }

        yield { kind: 'tool-end', name: synth.name, result, toolCallId: synth.id };
        actionResults.push({
          type: 'tool',
          name: synth.name,
          ok: result.ok,
          reason: result.ok ? undefined : result.reason,
          data: result.ok ? result.data : undefined,
        });
        if (!result.ok) actionErrorThisTurn += 1;
      }
    }

    // Turn-level is_final closes the loop after actions have run. Drop
    // is_final if this turn ran a reaction-requiring tool (navigate /
    // ask_user / ask_user_choice) — the result hasn't been observed yet.
    if (turn.is_final && !executedReactionRequiringTool) {
      actionResults.push({ type: 'done' });
      endLoopRequested = true;
    } else if (turn.is_final && executedReactionRequiringTool) {
      console.warn('[dddk webagent] dropping is_final=true — turn included a reaction-requiring tool; the run is not actually finished yet');
    }

    const envelopeData = {
      memory: turn.memory,
      todos_remaining: turn.todos_remaining,
      action_results: actionResults,
      page_changed: pageChanged,
    };
    pushAgentStep(session, {
      toolCall: { name: AGENT_TURN_TOOL, arguments: agentTurnCall.arguments },
      toolCallId: agentTurnCall.id,
      result: actionErrorThisTurn === 0
        ? { ok: true, data: envelopeData }
        : { ok: false, reason: 'unknown', message: JSON.stringify(envelopeData) },
    });
    agent.persistSessionInternal();

    if (actionErrorThisTurn > 0) {
      errorCount += 1;
      if (errorCount >= agent.configRef.maxErrors) {
        agent.setStatusInternal('failed');
        return;
      }
    } else {
      errorCount = 0;
    }

    if (endLoopRequested) {
      agent.setStatusInternal('idle');
      yield { kind: 'final' };
      return;
    }
  }

  // maxSteps hit. Yield `final` so the orchestrator's closure hook still
  // renders the closing UI.
  agent.setStatusInternal('failed');
  yield { kind: 'final' };
}
