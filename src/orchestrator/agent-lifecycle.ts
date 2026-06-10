/**
 * Agent lifecycle — owns building the WebAgent, the per-turn event
 * pump, confirm routing, loop-closure rendering, and all stop / resume
 * paths.
 *
 * Stateless helper class: receives the `DotDotDuck` host on construction
 * and reads / writes its internal `_*` fields. Wrapping these inside a
 * class keeps the file boundary stable without leaking a second public
 * type into the SDK surface.
 */

import {
  WebAgent,
  clearOverlays as clearWebagentOverlays,
  type WebAgentConfig,
  type AgentEvent,
  type SelectionContext,
} from '../agent';
import type { OnLoopEnd } from '../agent/webagent/types';
import { sdkString } from '../utils/sdk-i18n';
import type { DotDotDuck } from './index';
import { blobToDataUrl } from './helpers';

export class AgentLifecycle {
  constructor(private readonly host: DotDotDuck) {}

  /**
   * Kick the webagent. `selection` defaults to whatever was captured at the
   * last palette open — pass `{ selection: null }` to force no selection
   * context, or pass an explicit `SelectionContext` to override.
   */
  startAgent(task: string, options: { selection?: SelectionContext | null } = {}): void {
    const host = this.host;
    if (!host._config.llm) {
      host.subtitle.show({
        text: host._t('agent.no_webagent', 'No LLM configured — set `llm` on DotDotDuck.'),
        type: 'info',
        autoHide: 2500,
      });
      return;
    }
    if (!host._agentEnabled) {
      host.subtitle.show({
        text: host._t('agent.disabled', 'Agent is disabled.'),
        type: 'info',
        autoHide: 2000,
      });
      return;
    }
    if (!host._agentInstance) host._agentInstance = this.buildAgent();
    if (host._agentInstance.isRunning()) host._agentInstance.stop();
    // Wipe state from the previous round — borders / pin frames / subtitles
    // left over from a prior agent run shouldn't bleed into this one.
    // Without this the user sees stale "Agent · border(...)" pills and
    // outlines from the previous question still hanging around when they
    // start a new task.
    host._highlight.clearHighlight();
    clearWebagentOverlays();
    host.subtitle.hide();
    let selection =
      options.selection === undefined ? host._currentSelection : options.selection;

    // If no live window-selection is set but the palette has a pinned
    // context (Dwell-pinned element etc.), feed THAT into the agent's
    // SelectionContext so the agent knows which element the user is asking
    // about — without it the agent only sees the question + full DOM and
    // has to guess. We read from `pinnedContext` (sticky across palette
    // close) rather than `context.selectionText` (cleared on close) so this
    // still works when the handler ran `p.close()` before `startAgent`.
    if (!selection || (!selection.text && (!selection.elements || selection.elements.length === 0))) {
      const pinned = host.palette.pinnedContext;
      if (pinned.text || pinned.element) {
        selection = {
          ...(selection ?? {}),
          text: pinned.text || selection?.text,
          elements: pinned.element ? [pinned.element] : selection?.elements,
        };
      }
    }

    // Auto-attach images queued in the palette context (camera-captured PNGs)
    // as base64 data URLs in the agent's SelectionContext.images. webagent
    // already supports `images: string[]`. We also prepend a metadata note
    // to the task with each image's `sourceUrl` so the agent knows WHICH
    // page the screenshot is from — important when the user took the
    // screenshot on page A and then asks the question from page B.
    const queuedAttachments = host.palette.context.attachments.filter((a) => a.kind === 'image');
    if (queuedAttachments.length > 0) {
      void Promise.all(queuedAttachments.map((a) => blobToDataUrl(a.blob)))
        .then((images) => {
          const meta = queuedAttachments
            .map((a, i) => {
              const where = a.sourceUrl ? ` from ${a.sourceUrl}` : '';
              return `Image ${i + 1} (${a.source}${where})`;
            })
            .join('\n');
          const augmentedTask = meta
            ? `${task}\n\n[Attachments]\n${meta}`
            : task;
          const sel: SelectionContext = { ...(selection ?? {}), images };
          host._emitter.emit('agent_start', { task: augmentedTask });
          this.beginAgentRun(augmentedTask);
          this.runAgentStream(augmentedTask, { selection: sel });
          host.palette.clearAttachments();
        })
        .catch((err) => {
          console.warn('[dddk] failed to attach palette images, running without:', err);
          host._emitter.emit('agent_start', { task });
          this.beginAgentRun(task);
          this.runAgentStream(task, selection ? { selection } : {});
          host.palette.clearAttachments();
        });
      return;
    }

    host._emitter.emit('agent_start', { task });
    this.beginAgentRun(task);
    this.runAgentStream(task, selection ? { selection } : {});
  }

  runAgentStream(task: string, opts: { selection?: SelectionContext } = {}): void {
    const agent = this.host._agentInstance;
    if (!agent) return;
    const memory = this.host.memory;
    if (!memory) {
      void this.pumpAgentStream(agent.runStream(task, opts));
      return;
    }
    void memory.buildContext(task)
      .then((ctx) => {
        const augmented = ctx ? `${ctx}\n\n${task}` : task;
        return this.pumpAgentStream(agent.runStream(augmented, opts));
      })
      .catch((err) => {
        if (typeof console !== 'undefined') {
          console.warn('[dddk memory] buildContext failed; running without memory:', err);
        }
        return this.pumpAgentStream(agent.runStream(task, opts));
      });
  }

  private beginAgentRun(task: string): void {
    const host = this.host;
    host._intentBuffer.beginAgentRun(
      host._emitter,
      task,
      host._agentInstance?.getSession()?.id ?? '',
    );
  }

  endAgentRunCompleted(): void {
    const host = this.host;
    host._intentBuffer.endAgentRunCompleted(
      host._emitter,
      host._agentInstance?.getSession()?.id ?? '',
      host._agentInstance?.getSession()?.turns.length ?? 0,
    );
  }

  endAgentRunStopped(reason: 'close' | 'esc' | 'reject' | 'palette' | 'voice' | 'unknown'): void {
    const host = this.host;
    host._intentBuffer.endAgentRunStopped(
      host._emitter,
      host._agentInstance?.getSession()?.id ?? '',
      reason,
    );
  }

  /** Resume a saved session — used by the host's onMount after a full
   *  page reload. If there's no saved session or it's in a terminal
   *  state, no-ops. Otherwise pumps the stream into the dddk UI as if
   *  the loop had never been interrupted. */
  resumeAgent(): void {
    const host = this.host;
    if (!host._agentEnabled) return;
    if (!host._config.llm) return;
    if (!host._agentInstance) host._agentInstance = this.buildAgent();
    void this.pumpAgentStream(host._agentInstance.resumeStream());
  }

  /**
   * Fire the same "accept" gesture that single-tap Space fires on
   * desktop — emits `gesture_accept`, advances script skills waiting
   * on it, advances streaming pause hints, accepts confirm dialogs,
   * etc. Use this from a mobile FAB tap or any host-built "next"
   * button so touch users get the full Space-equivalent pipeline,
   * not just `subtitle.invokeAccept()` (which alone misses script
   * skills + intent analytics).
   */
  triggerAccept(): void {
    const host = this.host;
    host._emitter.emit('gesture_accept', undefined);
    host.subtitle.invokeAccept();
    host._intentBuffer.emitIntent(host._emitter, {
      kind: 'agent_answered',
      answer: 'accept',
      via: 'gesture',
      timestamp: Date.now(),
    });
  }

  /**
   * Fire the same "reject" gesture that double-tap Space fires on
   * desktop — emits `gesture_reject`, exits script skills, rejects
   * confirms, or stops an in-flight agent. Use this from a mobile
   * double-tap on the FAB / subtitle bar.
   */
  triggerReject(): void {
    const host = this.host;
    host._emitter.emit('gesture_reject', undefined);
    const hadReject = host.subtitle.invokeReject();
    if (!hadReject) {
      if (host._agentInstance?.isRunning()) {
        this.handleUserStopAgent('reject');
      } else {
        host.subtitle.hide();
      }
    }
    host._intentBuffer.emitIntent(host._emitter, {
      kind: 'agent_answered',
      answer: 'reject',
      via: 'gesture',
      timestamp: Date.now(),
    });
  }

  /**
   * Cross-cutting "stop the agent now" handler. Reasons:
   *   - `close`: user clicked the × on the subtitle bar
   *   - `esc`: Escape key while agent was running
   *   - `palette`: user opened the command palette (which means they
   *     want to send a new prompt)
   *   - `reject`: user double-tapped Space to reject
   *   - `voice`: user long-pressed Space to start a new voice prompt
   *
   * Surfaces a brief "stopped — say something new" subtitle so the user
   * knows their gesture worked and the agent is safely halted. Skipped
   * if the agent wasn't running (avoids "stopped" flashing on idle).
   */
  handleUserStopAgent(reason: 'close' | 'esc' | 'palette' | 'reject' | 'voice'): void {
    const host = this.host;
    const agent = host._agentInstance;
    if (!agent || !agent.isRunning()) return;
    // Emit BEFORE stop so the run still has its runId and dashboards
    // see the cancellation cleanly. The Push goes into currentRunIntents
    // too via emitIntent, so exportAgentRun() returns it.
    this.endAgentRunStopped(reason);
    // `palette` / `voice` are interruptions that come WITH a new prompt
    // attached — the user wants to redirect mid-task, not abandon the
    // conversation. Soft-stop so the next runStream() appends as a
    // follow-up turn even when `sessionContinuityMs: 0`. Other reasons
    // (× / Esc / double-tap reject) are explicit abandons → hard stop.
    if (reason === 'palette' || reason === 'voice') {
      agent.interruptForFollowup();
    } else {
      agent.stop();
    }
    host.subtitle.clearStreamed();
    host.subtitle.hideIndicator();
    host._highlight.clearHighlight();
    clearWebagentOverlays();
    // Voice + palette have their own next UI (mic indicator / palette
    // open) — don't double-up with a stopped subtitle that immediately
    // gets replaced. Close / esc / reject show the feedback line.
    if (reason === 'voice' || reason === 'palette') return;
    const key = reason === 'close' ? 'agent.stop_close'
      : reason === 'esc' ? 'agent.stop_esc'
      : 'agent.stop_reject';
    host.subtitle.show({ text: sdkString(host._config.locale, key), type: 'info', autoHide: 2500 });
  }

  /** Read a host-supplied indicator label override (`config.indicators
   *  .processing` / `.listening`). Accepts string or per-locale map. */
  private resolveIndicatorOverride(kind: 'processing' | 'listening'): string | null {
    const v = this.host._config.indicators?.[kind];
    if (!v) return null;
    if (typeof v === 'string') return v;
    return v[String(this.host._config.locale ?? 'en')] ?? v.en ?? null;
  }

  /** Pull the auto-hide ms for agent summary / error subtitles out of
   *  config. Returns 0 (sticky) when the host didn't configure it. */
  private resolveAgentAutoHide(kind: 'summary' | 'error'): number {
    const v = this.host._config.agentSubtitleAutoHideMs;
    if (v === undefined) return 0;
    if (typeof v === 'number') return v;
    return v[kind] ?? 0;
  }

  buildAgent(): WebAgent {
    const host = this.host;
    // Collect opted-in palette commands → expose as webagent custom actions.
    const paletteTools = host._collectPaletteTools();
    // Host-registered tools via `dddk.tools.register(...)` / `registerQA(...)`.
    // Snapshot is one-shot for the initial customActions set; tools registered
    // AFTER buildAgent() runs land via `this.tools.attachAgent(agent)` below.
    const hostTools = host.tools.snapshot();

    const agent = new WebAgent({
      ...host._config.webAgent,
      llm: host._config.llm!,
      locale: host._config.locale ?? host._config.webAgent?.locale,
      agentName: host._config.agentName ?? host._config.webAgent?.agentName,
      siteName: host._config.siteName ?? host._config.webAgent?.siteName,
      customActions: [
        ...(host._config.webAgent?.customActions ?? []),
        ...paletteTools,
        ...hostTools,
      ],
    });

    // Host router bridge — webagent emits `navigated` events; this
    // callback also drives the SPA goto (the agent's own code calls
    // this BEFORE the SPA settle window).
    agent.setNavigateBridge((path: string) => host._navigate(path));

    // Per-LLM-call performance sample → analytics dashboard. The webagent
    // measures TTFT and total stream duration locally; we tack on runId
    // and compute tokens-per-sec from the provider-reported output tokens.
    agent.setLlmCallListener((info) => {
      const runId = host._intentBuffer.currentRunId;
      if (!runId) return;
      const tokensPerSec = info.outputTokens && info.durationMs > 0
        ? Math.round((info.outputTokens * 1000) / info.durationMs)
        : undefined;
      host._intentBuffer.emitIntent(host._emitter, {
        kind: 'agent_llm_call',
        runId,
        role: info.role,
        ttftMs: info.ttftMs,
        durationMs: info.durationMs,
        outputTokens: info.outputTokens,
        inputTokens: info.inputTokens,
        tokensPerSec,
        model: info.model,
        timestamp: Date.now(),
      });
    });

    // ask_user / ask_user_choice are dispatched via the action handler;
    // the handler calls back into these to render the host UI.
    agent.setAskUserHandler(({ question, resolve }) => {
      const askedAt = Date.now();
      host._intentBuffer.emitIntent(host._emitter, { kind: 'agent_asked', question, timestamp: askedAt });
      host.subtitle.show({
        text: question,
        type: 'agent',
        onAccept: () => {
          const now = Date.now();
          host._intentBuffer.emitIntent(host._emitter, {
            kind: 'agent_answered', question, answer: 'yes', via: 'gesture', latencyMs: now - askedAt, timestamp: now,
          });
          resolve('yes');
        },
        onReject: () => {
          const now = Date.now();
          host._intentBuffer.emitIntent(host._emitter, {
            kind: 'agent_answered', question, answer: 'no', via: 'gesture', latencyMs: now - askedAt, timestamp: now,
          });
          resolve('no');
        },
        onCancel: () => resolve(''),
      });
    });

    agent.setAskUserChoiceHandler(({ question, options, allowFreeText, resolve }) => {
      const askedAt = Date.now();
      host._intentBuffer.emitIntent(host._emitter, { kind: 'agent_asked', question, timestamp: askedAt });
      host.subtitle.showChoice({
        question,
        options,
        allowFreeText,
        onChoose: (value, index) => {
          const now = Date.now();
          host._intentBuffer.emitIntent(host._emitter, {
            kind: 'agent_answered',
            question,
            answer: value,
            via: index === -1 ? 'text' : 'gesture',
            latencyMs: now - askedAt,
            timestamp: now,
          });
          resolve(value);
        },
        onCancel: () => resolve(''),
      });
    });

    // `pause` is the narrator's mid-stream beat. We DON'T spawn a
    // separate prompt subtitle — that would wipe the text the agent
    // just streamed. Instead, attach a "press space to continue" hint
    // to the existing streaming bar so the text remains visible while
    // the user reads. If for some reason there's no streaming bar
    // active (e.g. agent called pause as its first action), fall back
    // to a regular ask_user-style prompt so the gesture still works.
    agent.setPauseHandler(({ hint, resolve }) => {
      const emitPauseDecision = (decision: 'continue' | 'stop'): void => {
        const runId = host._intentBuffer.currentRunId;
        if (!runId) return;
        host._intentBuffer.emitIntent(host._emitter, {
          kind: 'agent_pause_decision',
          runId,
          decision,
          timestamp: Date.now(),
        });
      };
      if (host.subtitle.isStreaming()) {
        host.subtitle.applyStreamingPauseHint({
          hint,
          onAccept: () => {
            // Wipe the streamed text so the NEXT subject starts in a
            // clean bar. Each subject in the walkthrough is its own
            // paragraph; accumulating across subjects makes the bar
            // read as one tangled wall-of-text. (The streaming bar el
            // itself stays mounted so the next text-delta appends
            // smoothly with no visible flicker.)
            host.subtitle.replaceStreamed('');
            emitPauseDecision('continue');
            resolve('continue');
          },
          onReject: () => {
            emitPauseDecision('stop');
            resolve('');
            this.handleUserStopAgent('reject');
          },
        });
      } else {
        // No streaming bar — fall back to the regular agent prompt.
        host.subtitle.show({
          text: hint,
          type: 'agent',
          onAccept: () => { emitPauseDecision('continue'); resolve('continue'); },
          onReject: () => {
            emitPauseDecision('stop');
            resolve('');
            this.handleUserStopAgent('reject');
          },
          onCancel: () => resolve(''),
        });
      }
    });

    // Attach the live agent to the tools registry so any future
    // `dddk.tools.register(...)` calls flow into this running agent
    // immediately, not just into the snapshot at build time.
    host.tools.attachAgent(agent);

    return agent;
  }

  // ─── agent event pump ──────────────────────────────────────────
  /**
   * Consume the agent's AsyncIterable<AgentEvent> stream and route each
   * event to its dddk UI slot:
   *
   *   thinking     → showIndicator('processing')
   *   text-delta   → subtitle.appendStreamed(delta) (cancels the indicator)
   *   tool-start   → frame target element, hide indicator
   *   tool-end     → no-op (next text-delta or next tool-start carries the visual)
   *   confirm      → subtitle.show with onAccept / onReject calling decide()
   *   navigated    → clear overlays (the bridge already moved the router)
   *   final        → finalizeStreamed with autoHide
   *   error        → subtitle.show error
   *
   * The async `for await` loop runs in the background — the host's
   * `startAgent()` returns synchronously, and event handlers on the
   * orchestrator (gestures, palette, voice) keep firing throughout.
   */
  async pumpAgentStream(stream: AsyncIterable<AgentEvent>): Promise<void> {
    const host = this.host;
    const thinkingLabel =
      this.resolveIndicatorOverride('processing')
      ?? sdkString(host._config.locale, 'agent.thinking');
    const finalAutoHide = this.resolveAgentAutoHide('summary');

    // Universal "agent is no longer running" cleanup. Fires on:
    //   - natural completion (final / error)
    //   - exception inside the pump
    //   - external `agent.stop()` (stream exits with signal aborted)
    //   - any other path that ends the for-await
    // Symptom we're guarding against: thinking indicator camping on
    // screen after the agent halted via click-outside / palette open /
    // long-press voice / esc. ANY stop reason should clear it.
    const safeCleanup = (): void => {
      host.subtitle.hideIndicator();
      host._highlight.clearHighlight();
      clearWebagentOverlays();
    };

    try {
      for await (const ev of stream) {
        switch (ev.kind) {
          case 'thinking':
            if (!host.subtitle.isStreaming()) {
              host.subtitle.showIndicator('processing', thinkingLabel);
            }
            host._emitter.emit('agent_thinking', undefined);
            break;

          case 'text-delta':
            host.subtitle.appendStreamed(ev.delta);
            break;

          case 'tool-start':
            host.subtitle.hideIndicator();
            if (ev.targetSelector) {
              // Resolve numeric `[N]` indexes via the agent's per-turn
              // map before falling through to CSS selector matching.
              // Without this, the LLM passing a bare "13" would crash
              // querySelector with SyntaxError.
              const resolved = host._agentInstance?.resolveSelector(ev.targetSelector);
              if (resolved) host._highlight.highlightElement(resolved as HTMLElement);
              else host._highlight.highlightElement(ev.targetSelector);
            }
            host._emitter.emit('agent_tool_start', { name: ev.name, args: ev.args, targetSelector: ev.targetSelector });
            break;

          case 'tool-end':
            host._emitter.emit('agent_tool_end', { name: ev.name, result: ev.result });
            break;

          case 'navigating':
            // SPA route change kicked off but the new page isn't ready
            // to read yet — show a polished loading indicator until
            // `navigated` arrives.
            host.subtitle.showIndicator('processing', sdkString(host._config.locale, 'agent.loading'));
            clearWebagentOverlays();
            host._highlight.clearHighlight();
            break;

          case 'navigated':
            // New page settled. Hide the loading indicator; the next
            // text-delta from the model will create the streaming bar
            // for narration about the new page.
            host.subtitle.hideIndicator();
            break;

          case 'confirm':
            await this.routeConfirm(ev);
            break;

          case 'final':
            // Close the streamed narration first, then render the
            // host-configured loop-closure (text / feedback / ask_user
            // / silent). Without this the bar just disappears, which
            // reads as a broken UI rather than a finished run.
            host.subtitle.finalizeStreamed(
              finalAutoHide > 0 ? { autoHide: finalAutoHide } : {},
            );
            host._highlight.clearHighlight();
            clearWebagentOverlays();
            host._emitter.emit('agent_final', undefined);
            await this.renderLoopClosure();
            this.endAgentRunCompleted();
            break;

          case 'error':
            host.subtitle.hideIndicator();
            if (!ev.retrying) {
              const errMsg = host._config.locale === 'zh-TW'
                ? `出了點問題：${ev.error.message}`
                : `Something went wrong: ${ev.error.message}`;
              if (host.subtitle.isStreaming()) {
                host.subtitle.appendStreamed('\n\n' + errMsg);
                host.subtitle.finalizeStreamed({ autoHide: 6_000 });
              } else {
                host.subtitle.show({ text: errMsg, type: 'info', autoHide: 6_000 });
              }
              host._highlight.clearHighlight();
              clearWebagentOverlays();
              host._emitter.emit('agent_error', { error: ev.error });
            }
            break;
        }
      }
    } catch (err) {
      // Pump itself threw (shouldn't normally — agent catches its own
      // errors and emits `error` events). Defensive cleanup.
      if (host.subtitle.isStreaming()) {
        host.subtitle.finalizeStreamed({ autoHide: 4_000 });
      }
      safeCleanup();
      if (typeof console !== 'undefined') {
        console.warn('[dddk] agent pump threw:', err);
      }
    } finally {
      // Always-fires cleanup. Handles the "stream ended without firing
      // a terminal event" case — most commonly when an external
      // `agent.stop()` (via close button, esc, palette open,
      // long-press voice) aborts the loop mid-flight. Without this
      // hook the thinking indicator stayed up forever.
      safeCleanup();
    }
  }

  /**
   * Resolve the active `onLoopEnd` config — host override, or the SDK
   * default of a temperate "✓ Done" line. Returning `{kind: 'silent'}`
   * means legacy "subtitle disappears" behaviour.
   */
  private resolveLoopEnd(): OnLoopEnd {
    const hostCfg = this.host._config.webAgent?.onLoopEnd;
    if (hostCfg) return hostCfg;
    return {
      kind: 'text',
      text: sdkString(this.host._config.locale, 'agent.done'),
      autoHide: 3000,
    };
  }

  /**
   * Render the configured loop closure when the agent loop ends. Sits
   * between `finalizeStreamed` and `endAgentRunCompleted` in
   * pumpAgentStream.
   *
   * Each kind maps onto an existing subtitle surface:
   *   text     → subtitle.show with autoHide; no gesture wiring.
   *   feedback → subtitle.show with onAccept/onReject/onCancel, emits
   *              `agent_feedback` with satisfied = true / false / null.
   *   ask_user → subtitle.showChoice; the picked value flows into
   *              `agent_feedback.summary`.
   *   silent   → no-op; legacy "subtitle disappears" behavior.
   */
  private async renderLoopClosure(): Promise<void> {
    const host = this.host;
    const closure = this.resolveLoopEnd();
    if (closure.kind === 'silent') return;

    if (closure.kind === 'text') {
      const autoHide = closure.autoHide ?? 3000;
      host.subtitle.show({
        text: closure.text,
        type: 'agent',
        autoHide,
      });
      // Don't block endAgentRunCompleted on the autoHide window — the
      // run is logically complete already; the subtitle just dwells.
      return;
    }

    // Snapshot the run + skill at closure render time. Both are stored
    // on every agent_feedback IntentEvent so the dashboard can roll up
    // satisfaction by run or by skill without time-window heuristics.
    const runId = host._intentBuffer.currentRunId ?? undefined;
    const skillId = host._intentBuffer.currentSkillId ?? undefined;

    if (closure.kind === 'feedback') {
      const now = (): number => Date.now();
      // `persistent: true` removes every passive dismiss path — × close
      // button hidden, Esc ignored, outside-click / any-key ignored.
      // The bar can only close via Space (accept), double-tap (reject),
      // or click on the ✓ / ✕ buttons. Trade-off: visitor can't skip the
      // prompt, but we always get a labelled satisfied/not-satisfied
      // signal — that's the whole point of opting into feedback mode.
      await new Promise<void>((resolve) => {
        const close = (satisfied: boolean): void => {
          host._intentBuffer.emitIntent(host._emitter, {
            kind: 'agent_feedback', runId, skillId, satisfied, summary: closure.text, timestamp: now(),
          });
          // Tear the bar down — accept / reject callbacks don't go through
          // the gesture-manager `invokeAccept` path that normally hides
          // the subtitle, so we hide it here. Without this the bar stays
          // visible after the click and the user thinks ✓ / ✕ didn't fire.
          host.subtitle.hide();
          resolve();
        };
        host.subtitle.show({
          text: closure.text,
          type: 'agent',
          persistent: true,
          onAccept: () => close(true),
          onReject: () => close(false),
        });
      });
      return;
    }

    // ask_user — picker with the host's options. Picked value goes
    // into the agent_feedback intent so dashboards can break down
    // satisfaction by chosen bucket.
    const optionLabels = closure.options.map((o) => o.label);
    await new Promise<void>((resolve) => {
      host.subtitle.showChoice({
        question: closure.question,
        options: optionLabels,
        allowFreeText: false,
        onChoose: (value, index) => {
          const picked = closure.options[index];
          host._intentBuffer.emitIntent(host._emitter, {
            kind: 'agent_feedback',
            runId,
            skillId,
            satisfied: null,
            summary: picked?.value ?? value,
            timestamp: Date.now(),
          });
          resolve();
        },
        onCancel: () => {
          host._intentBuffer.emitIntent(host._emitter, {
            kind: 'agent_feedback', runId, skillId, satisfied: null, summary: '', timestamp: Date.now(),
          });
          resolve();
        },
      });
    });
  }

  /**
   * Route a `confirm` event to the subtitle bar with Space-accept /
   * double-tap-reject wiring. The agent is awaiting `decide()` — we
   * resolve it from the user's gesture.
   */
  private async routeConfirm(ev: Extract<AgentEvent, { kind: 'confirm' }>): Promise<void> {
    const host = this.host;
    const targetSelector =
      (typeof ev.args.selector === 'string' ? ev.args.selector : null) ??
      (typeof ev.args.target === 'string' ? ev.args.target : null) ??
      (typeof ev.args.element === 'string' ? ev.args.element : null);
    if (targetSelector) {
      const resolved = host._agentInstance?.resolveSelector(targetSelector);
      if (resolved) host._highlight.highlightElement(resolved as HTMLElement);
      else host._highlight.highlightElement(targetSelector);
    } else {
      host._highlight.clearHighlight();
    }

    await new Promise<void>((resolve) => {
      host.subtitle.show({
        text: ev.message,
        type: 'agent',
        onAccept: () => {
          host._intentBuffer.emitIntent(host._emitter, {
            kind: 'confirm_action', actionName: ev.actionName, params: ev.args, approved: true, timestamp: Date.now(),
          });
          ev.decide(true);
          resolve();
        },
        onReject: () => {
          host._intentBuffer.emitIntent(host._emitter, {
            kind: 'confirm_action', actionName: ev.actionName, params: ev.args, approved: false, timestamp: Date.now(),
          });
          host._highlight.clearHighlight();
          ev.decide(false);
          resolve();
        },
        onCancel: () => {
          host._highlight.clearHighlight();
          ev.decide(false);
          resolve();
        },
      });
    });
  }

  /**
   * Collect palette commands that have opted into agent exposure
   * (via `agentTool: {...}`), turn them into WebAgent customActions.
   */
  collectPaletteTools(): NonNullable<WebAgentConfig['customActions']> {
    const host = this.host;
    const tools: NonNullable<WebAgentConfig['customActions']> = [];

    // Per-item exposure — items the host opted into via `agentTool: {...}`
    // become their own named agent tools. Same shape as before.
    for (const item of host.palette.getItems()) {
      if (!item.agentTool || !item.handler) continue;
      tools.push({
        name: this.toolNameOf(item),
        description: item.agentTool.description,
        parameters: item.agentTool.parameters,
        requireConfirmation: item.agentTool.requireConfirmation,
        handler: async (params) => {
          const arg = (params as { arg?: string }).arg ?? '';
          try {
            // Reuse the palette item's handler — agent sees same result host expected
            await item.handler!({
              close: () => {},
              replace: () => {},
              get input() { return ''; },
              setInput: () => {},
              get context() {
                return { selectionText: '', attachments: [] };
              },
              showResult: () => {},
              clearResult: () => {},
              setInputContext: () => {},
              clearInputContext: () => {},
            }, arg);
            return { ok: true };
          } catch (err) {
            return { ok: false, reason: 'unknown' as const, message: (err as Error).message };
          }
        },
      });
    }

    // `open_palette` was previously registered here as a generic "show
    // the UI and let the agent click into it" tool. Removed in v0.1.0+:
    // multi-step UI navigation (open → click row → click sub-menu) is
    // unreliable on small models. Hosts that want the agent to invoke a
    // palette command now register semantic intent tools instead — e.g.
    // `immersive_translate({language})`, `start_site_tour()`,
    // `search_docs({query})`. The host's tool handler drives the palette
    // UI animation if visual feedback is desired. See
    // `dddk-frontend/src/lib/agent-tools.ts` for the reference pattern.

    return tools;
  }

  /** Normalize palette id → safe action name (a-z0-9_). */
  private toolNameOf(item: import('../triggers/command-palette').PaletteItem): string {
    return `palette_${item.id.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;
  }
}
