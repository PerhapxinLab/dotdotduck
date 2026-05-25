/**
 * WebAgent — DOM-grounded autonomous agent for any webpage.
 *
 * The agent observes the current page DOM, reasons via the configured LLM,
 * and executes one action per step from the tool registry until it calls
 * `done` or hits `maxSteps` / `maxErrors`. It never sees content outside
 * the visible DOM — that's the security boundary.
 *
 * @example Basic usage
 * ```ts
 * import { WebAgent, OpenAIProvider } from '@perhapxin/dddk';
 *
 * const agent = new WebAgent({
 *   llm: new OpenAIProvider({ apiKey: process.env.OPENAI_KEY! }),
 *   siteName: 'Acme CRM',
 * });
 *
 * agent.on('subtitle', (text) => console.log('agent:', text));
 * agent.on('done', (session) => console.log('finished:', session.summary));
 *
 * await agent.run('Refund order ORD-1002 and email the customer');
 * ```
 *
 * @example Per-role LLM routing (mix providers)
 * ```ts
 * import { WebAgent, OpenAIProvider, GoogleProvider } from '@perhapxin/dddk';
 *
 * const agent = new WebAgent({
 *   llm: {
 *     webagent: new OpenAIProvider({ apiKey, model: 'gpt-5.5' }),
 *     webagentWithSelection: new OpenAIProvider({ apiKey, model: 'gpt-5.4-mini' }),
 *     select: new GoogleProvider({ apiKey: gKey, model: 'gemini-3.1-flash-lite-preview' }),
 *     voiceCleanup: new GoogleProvider({ apiKey: gKey, model: 'gemini-3.1-flash-lite-preview' }),
 *   },
 * });
 * ```
 *
 * @example Brand-aware prompt with safety constraints
 * ```ts
 * new WebAgent({
 *   llm,
 *   brand: {
 *     productName: 'Acme CRM',
 *     voice: 'Friendly, concise, no emoji.',
 *     constraints: ['Refunds require user confirmation', 'Never expose customer email to other customers'],
 *   },
 *   appendSystemPrompt: 'Acme order IDs always start with ORD-.',
 * });
 * ```
 *
 * See [docs/01-architecture.md](../../../docs/01-architecture.md) for the
 * design, [docs/11-prompt-design.md](../../../docs/11-prompt-design.md) for
 * prompt layering, [docs/12-session-continuity.md](../../../docs/12-session-continuity.md)
 * for cross-tab session sync.
 */

import type {
  WebAgentConfig,
  AgentSession,
  AgentStatus,
  AgentEventName,
  AgentEventMap,
  AgentEventHandler,
  ActionDefinition,
  ActionResult,
  RunOptions,
  SelectionContext,
} from './types';
import type { LLMMessage, ToolDefinition } from '../llm/types';
import { resolveLLM } from '../llm/router';
import { TypedEmitter } from './event-emitter';
import {
  createSession,
  loadSession,
  saveSession,
  clearSession,
  DEFAULT_SESSION_KEY,
} from './session';
import { assembleSystemPrompt } from './prompt';
import { builtinActions } from './actions';
import { readDOM } from './dom-reader';
import { setupCrossTabSync, publishCrossTab } from './cross-tab';
import { executeAction as runAction } from './execute-action';

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_MAX_ERRORS = 3;

export class WebAgent {
  private config: Required<
    Pick<WebAgentConfig, 'locale' | 'maxSteps' | 'maxErrors' | 'agentName' | 'sessionStorageKey'>
  > &
    WebAgentConfig;
  private emitter = new TypedEmitter();
  private session: AgentSession | null = null;
  private status: AgentStatus = 'idle';
  private currentAbort: AbortController | null = null;
  private actions: Map<string, ActionDefinition> = new Map();
  /**
   * Pending resolvers for actions that yield control to the host
   * (`ask_user`). Keyed by request id so concurrent interactions don't
   * clobber one another.
   */
  private pendingResolvers: Map<string, (raw: string) => void> = new Map();
  /**
   * FIFO of pending request ids — `respond(text)` without an explicit
   * id resolves the oldest pending interaction.
   */
  private pendingOrder: string[] = [];
  private currentSelection: SelectionContext | null = null;
  private previousPageUrl: string | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private crossTabKey: string;
  private pendingCounter = 0;

  constructor(config: WebAgentConfig) {
    this.config = {
      locale:
        config.locale ??
        ((typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')
          ? 'zh-TW'
          : 'en') as 'en' | 'zh-TW'),
      maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
      maxErrors: config.maxErrors ?? DEFAULT_MAX_ERRORS,
      agentName: config.agentName ?? 'Agent',
      sessionStorageKey: config.sessionStorageKey ?? DEFAULT_SESSION_KEY,
      ...config,
    };

    // Register built-in actions first, then custom (custom can override built-ins).
    for (const action of builtinActions) {
      this.actions.set(action.name, action);
    }
    for (const action of config.customActions ?? []) {
      this.actions.set(action.name, action);
    }

    this.crossTabKey = `${this.config.sessionStorageKey}.crosstab`;
    if (config.crossTabSync) {
      this.broadcastChannel = setupCrossTabSync({
        crossTabKey: this.crossTabKey,
        getCurrentSessionId: () => this.session?.id,
        isLocalRunActive: () => this.isRunning(),
        getLocalUpdatedAt: () => this.session?.updatedAt,
        adoptSession: (s) => {
          this.session = s;
        },
      });
    }
  }

  private persistSession(): void {
    if (!this.session) return;
    saveSession(this.session, this.config.sessionStorageKey);
    publishCrossTab(this.session, this.crossTabKey, this.broadcastChannel);
  }

  // ─── public API ─────────────────────────────────────────────────

  on<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): void {
    this.emitter.on(event, handler);
  }

  off<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): void {
    this.emitter.off(event, handler);
  }

  registerAction(action: ActionDefinition): void {
    this.actions.set(action.name, action);
  }

  getSession(): AgentSession | null {
    return this.session;
  }

  clearSession(): void {
    this.session = null;
    clearSession(this.config.sessionStorageKey);
  }

  isRunning(): boolean {
    return this.status === 'thinking' || this.status === 'executing' || this.status === 'waiting';
  }

  /** Cancel the current run. */
  stop(): void {
    if (this.currentAbort) {
      this.currentAbort.abort('user_stopped');
      this.currentAbort = null;
    }
    // Reject all in-flight host interactions with empty replies.
    for (const id of this.pendingOrder) {
      const r = this.pendingResolvers.get(id);
      if (r) r('');
    }
    this.pendingResolvers.clear();
    this.pendingOrder = [];
    this.setStatus('idle');
  }

  /** Tear down channels / listeners. Call when the host unmounts. */
  destroy(): void {
    this.stop();
    this.broadcastChannel?.close();
    this.broadcastChannel = null;
  }

  /**
   * Resolve the oldest pending host interaction (ask_user).
   * If multiple are in flight they're FIFO — call once per outstanding prompt.
   */
  respond(answer: string | Record<string, unknown>): void {
    const id = this.pendingOrder.shift();
    if (!id) return;
    const resolver = this.pendingResolvers.get(id);
    if (!resolver) return;
    this.pendingResolvers.delete(id);
    resolver(typeof answer === 'string' ? answer : JSON.stringify(answer));
  }

  private registerPendingResolver(resolver: (raw: string) => void): string {
    const id = `pr_${++this.pendingCounter}_${Date.now().toString(36)}`;
    this.pendingResolvers.set(id, resolver);
    this.pendingOrder.push(id);
    return id;
  }

  /**
   * Run a new task. Abandons any in-flight session, starts fresh.
   *
   * The agent loop:
   *   1. Read DOM → assemble system prompt → call LLM
   *   2. LLM emits a tool call → look up action → execute → record result
   *   3. Repeat until `done`, `maxSteps`, or `maxErrors`.
   *
   * Pass `options.selection` when the user had something selected at
   * invocation time (text / images / clicked elements). The agent gets
   * a "User selection at invocation" block in its prompt, and if
   * `llm.webagentWithSelection` is configured on an LLMRouter, that
   * cheaper model is used for the run.
   *
   * @param task Natural-language description of what to accomplish.
   * @param options Runtime overrides — currently just `selection`.
   *
   * @example
   * ```ts
   * await agent.run('Refund order ORD-1002 and email the customer');
   *
   * // With selection context:
   * await agent.run('Summarize this clause', {
   *   selection: {
   *     text: 'Either party may terminate...',
   *     elements: ['#clause-4'],
   *   },
   * });
   * ```
   */
  async run(task: string, options: RunOptions = {}): Promise<void> {
    this.stop(); // cancel any in-flight run

    const currentPage = typeof location !== 'undefined' ? location.pathname : '/';
    this.session = createSession(task, currentPage);
    this.currentSelection = options.selection ?? null;
    this.persistSession();

    this.currentAbort = new AbortController();
    await this.loop(this.currentAbort.signal);
  }

  /** Resume an existing session from sessionStorage (call on page load). */
  async resume(): Promise<void> {
    const saved = loadSession(this.config.sessionStorageKey);
    if (!saved) return;
    if (saved.status === 'done' || saved.status === 'failed') return;

    this.session = saved;
    this.currentAbort = new AbortController();
    await this.loop(this.currentAbort.signal);
  }

  // ─── internal ───────────────────────────────────────────────────

  private setStatus(status: AgentStatus): void {
    if (this.status === status) return;
    this.status = status;
    if (this.session) this.session.status = status;
    this.emitter.emit('status', status);
  }

  private async loop(signal: AbortSignal): Promise<void> {
    if (!this.session) return;
    let errorCount = 0;

    for (let stepIdx = this.session.steps.length; stepIdx < this.config.maxSteps; stepIdx++) {
      // Track navigation: if the URL changed since last step, record the prior page.
      const nowUrl = typeof location !== 'undefined' ? location.pathname + location.search : null;
      if (this.session.currentPage !== nowUrl && nowUrl) {
        this.previousPageUrl = this.session.currentPage;
        this.session.currentPage = nowUrl;
      }
      if (signal.aborted) return;

      this.setStatus('thinking');

      let result: ActionResult;
      let actionName: string;
      let actionParams: Record<string, unknown>;
      let actionCallId: string | undefined;

      try {
        const messages = this.buildMessages();
        const tools = this.buildToolDefinitions();

        const llm = resolveLLM(
          this.config.llm,
          this.currentSelection ? 'webagentWithSelection' : 'webagent'
        );
        const response = await llm.complete({
          messages,
          tools,
          signal,
        });

        const call = response.toolCalls?.[0];
        if (!call) {
          // No tool call — treat content as a `done` summary fallback.
          this.session.summary = response.content || '(no response)';
          this.emitter.emit('subtitle', this.session.summary);
          this.setStatus('done');
          this.persistSession();
          this.emitter.emit('done', this.session);
          return;
        }

        actionName = call.name;
        actionParams = call.arguments;
        actionCallId = call.id;
      } catch (err) {
        if (signal.aborted) return;
        errorCount += 1;
        this.emitter.emit('error', err as Error);
        if (errorCount >= this.config.maxErrors) {
          this.setStatus('failed');
          if (this.session) {
            this.persistSession();
            this.emitter.emit('done', this.session);
          }
          return;
        }
        // Backoff between consecutive LLM errors so a transient upstream
        // blip doesn't burn through the error budget in 50 ms. 400 / 800 /
        // 1600 ms by errorCount; capped at maxErrors so the loop never
        // sleeps for more than ~2 s before failing out.
        await new Promise<void>((r) => setTimeout(r, 400 * Math.pow(2, errorCount - 1)));
        continue;
      }

      // Special action: done
      if (actionName === 'done') {
        const summary = String(actionParams.summary ?? '');
        this.session.summary = summary;
        if (summary) this.emitter.emit('subtitle', summary);
        this.setStatus('done');
        this.persistSession();
        this.emitter.emit('done', this.session);
        return;
      }

      this.setStatus('executing');

      // Pre-action hook — visual layers (agent cursor, action overlay) can
      // preview the target with a pause before the handler runs.
      const targetSelector = extractTargetSelector(actionParams);
      this.emitter.emit('before_action', {
        actionName,
        params: actionParams,
        targetSelector,
      });

      // Step-by-step gate — confirmation fires in two cases:
      //   1. `config.confirmEachStep` is on (demo / onboarding mode), which
      //      forces a confirm BEFORE every action regardless of its config.
      //   2. The matched action has `requireConfirmation: true` (or a
      //      function returning true for these params). This is the
      //      per-action gate for destructive operations — delete order,
      //      transfer funds, send email — that should ALWAYS confirm even
      //      in step-mode-off automations.
      //
      // When either gate fires, we emit `confirm_action` and AWAIT the
      // host's decision. The host wires the subtitle bar to call
      // `decide(true)` on space accept, `decide(false)` on double-tap reject.
      // If the user rejects, the loop stops gracefully.
      const matched = this.actions.get(actionName);
      const perActionGate = matched?.requireConfirmation;
      let perActionNeedsConfirm = false;
      if (perActionGate === true) {
        perActionNeedsConfirm = true;
      } else if (typeof perActionGate === 'function') {
        try {
          perActionNeedsConfirm = await perActionGate(actionParams as never, {
            session: this.session,
            signal,
            emit: (event, payload) =>
              this.emitter.emit(event as AgentEventName, payload as AgentEventMap[AgentEventName]),
          });
        } catch (err) {
          // Fail-safe: if the predicate throws, treat as confirmation
          // required — we'd rather pause than silently bypass the gate.
          if (typeof console !== 'undefined') {
            console.warn('[webagent] requireConfirmation predicate threw:', (err as Error).message);
          }
          perActionNeedsConfirm = true;
        }
      }

      if (this.config.confirmEachStep || perActionNeedsConfirm) {
        const customMessage = matched?.confirmationMessage?.(actionParams as never);
        const message = customMessage ?? narrateAction(actionName, actionParams, targetSelector, this.config.locale);
        const approved = await new Promise<boolean>((resolve) => {
          this.emitter.emit('confirm_action', {
            actionName,
            params: actionParams,
            message,
            decide: (ok) => resolve(ok),
          });
        });
        if (!approved) {
          this.session.summary = '(stopped by user)';
          this.setStatus('done');
          this.persistSession();
          this.emitter.emit('done', this.session);
          return;
        }
      }

      result = await runAction(
        {
          actions: this.actions,
          registerPendingResolver: (r) => this.registerPendingResolver(r),
          emit: (event, payload) =>
            this.emitter.emit(event as AgentEventName, payload as AgentEventMap[AgentEventName]),
          setStatus: (s) => this.setStatus(s),
          session: this.session!,
          // Interactive mode = step-by-step confirmations are on. This
          // gates whether show_subtitle pauses for the user to acknowledge.
          interactive: this.config.confirmEachStep ?? false,
        },
        actionName,
        actionParams,
        signal,
      );

      this.session.steps.push({
        action: { name: actionName, params: actionParams },
        result,
        timestamp: Date.now(),
        toolCallId: actionCallId,
      });
      this.persistSession();
      this.emitter.emit('step', this.session.steps[this.session.steps.length - 1]!);

      if (!result.ok) {
        errorCount += 1;
        if (errorCount >= this.config.maxErrors) {
          this.setStatus('failed');
          this.persistSession();
          this.emitter.emit('done', this.session);
          return;
        }
      } else {
        errorCount = 0;
      }
    }

    // Hit max steps
    this.setStatus('failed');
    this.persistSession();
    this.emitter.emit('done', this.session);
  }

  private buildMessages(): LLMMessage[] {
    if (!this.session) return [];

    const pageContext = readDOM();
    const systemPrompt = assembleSystemPrompt({
      locale: this.config.locale,
      agentName: this.config.agentName,
      siteName: this.config.siteName,
      systemPrompt: this.config.systemPrompt,
      brand: this.config.brand,
      appendSystemPrompt: this.config.appendSystemPrompt,
      sitemap: this.config.sitemap,
      session: this.session,
      pageContext,
      selection: this.currentSelection ?? undefined,
      previousUrl: this.previousPageUrl ?? undefined,
      interactiveMode: this.config.confirmEachStep ?? false,
    });

    const selectionBlock = this.currentSelection ? renderSelection(this.currentSelection) : '';
    const userText =
      `Task: ${this.session.task}\n\n` +
      `Current page: ${this.session.currentPage}\n\n` +
      (selectionBlock ? `User selection at invocation:\n${selectionBlock}\n\n` : '') +
      `Page context:\n${pageContext}`;

    // If the host attached image(s) via `selection.images` (typically a
    // dwell-element screenshot), build the user content as a multi-part
    // array so the bytes actually reach the LLM.
    const images = this.currentSelection?.images ?? [];
    const userContent = images.length > 0
      ? [
          { type: 'text' as const, text: userText },
          ...images.map((img) => ({ type: 'image' as const, image: img })),
        ]
      : userText;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: userContent,
      },
    ];

    // Recent steps as compact assistant + tool messages. Cap is the
    // memory window the model sees of THIS task's tool calls — too low
    // and the agent forgets what it did 5 steps ago in the same task;
    // too high and prompts bloat. 12 fits most tour-length tasks; the
    // host can override via `maxSteps` (run cap) but the slice itself
    // is internal.
    const recent = this.session.steps.slice(-12);
    const baseIdx = this.session.steps.length - recent.length;
    for (let i = 0; i < recent.length; i++) {
      const step = recent[i]!;
      const id = step.toolCallId ?? `step_${baseIdx + i}_${step.timestamp}`;
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: [{ id, name: step.action.name, arguments: step.action.params }],
      });
      messages.push({
        role: 'tool',
        toolCallId: id,
        name: step.action.name,
        content: JSON.stringify(step.result),
      });
    }

    return messages;
  }

  private buildToolDefinitions(): ToolDefinition[] {
    if (this.config.toolDefinitions) return this.config.toolDefinitions;

    const defs: ToolDefinition[] = [];
    for (const action of this.actions.values()) {
      defs.push({
        name: action.name,
        description: action.description,
        parameters: action.parameters,
      });
    }
    // Always include `done`
    defs.push({
      name: 'done',
      description: 'Mark the task as complete and stop the agent loop.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: 'Brief summary of what was done.' } },
      },
    });
    return defs;
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function renderSelection(sel: SelectionContext): string {
  const parts: string[] = [];
  if (sel.text) parts.push(`Text: "${sel.text}"`);
  if (sel.elements?.length) parts.push(`Elements: ${sel.elements.join(', ')}`);
  if (sel.bbox) parts.push(`Bounding box: ${JSON.stringify(sel.bbox)}`);
  if (sel.images?.length) parts.push(`Images: ${sel.images.length} attached`);
  return parts.join('\n');
}

/**
 * Best-effort extraction of a CSS selector from action params, so visual
 * layers (agent cursor) know where to point before the handler runs.
 * Most built-in actions use `selector`, `target`, or `element` as the field.
 */
function extractTargetSelector(params: Record<string, unknown>): string | undefined {
  for (const key of ['selector', 'target', 'element']) {
    const v = params[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Friendly natural-language description of an upcoming action — used by
 * `confirmEachStep` mode so the subtitle bar reads like a narration
 * ("I'll click the Docs link") rather than a debug log
 * ("Agent · click(.sidebar-link)"). Falls back to the raw shape when
 * the action isn't one of the common built-ins.
 */
/**
 * Build the human-readable confirmation message for `confirm_action`.
 * Localised via the agent's `locale` config. Hosts that want to override
 * the narration entirely can set `confirmationMessage` per-action — that
 * fires before narrateAction in WebAgent.loop().
 */
function narrateAction(
  actionName: string,
  params: Record<string, unknown>,
  targetSelector?: string,
  locale?: string,
): string {
  const str = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '');
  const trim = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const targetSel = targetSelector ?? str('selector') ?? str('target') ?? str('element');
  // Element-friendly label: try the element's visible innerText FIRST
  // so the confirmation reads "要強調 「Inline AI — 在輸入框裡選文字」" instead
  // of "要強調 section:nth-child(5)". Falls back to the raw selector only
  // if the element isn't queryable or has no text.
  const target = describeElement(targetSel) ?? trim(targetSel, 50);
  // Bundled UI translations. zh-TW gets the localised confirmation; any
  // other locale (or unset) falls back to English. Hosts that want other
  // languages should override `confirmationMessage` per ActionDefinition.
  const isZh = locale === 'zh-TW' || locale?.startsWith('zh');
  if (isZh) {
    switch (actionName) {
      case 'navigate':       return `要前往 ${trim(str('path'))},確認嗎?`;
      case 'click':          return `要點擊 ${target},確認嗎?`;
      case 'fill_input':
      case 'set_text':       return `要在 ${target} 填入「${trim(str('value') || str('text'), 28)}」,確認嗎?`;
      case 'scroll_to':      return `要捲動到 ${target},確認嗎?`;
      case 'submit_form':    return `要送出表單 ${target},確認嗎?`;
      case 'select_option':  return `要選 ${trim(str('value'), 28)},確認嗎?`;
      case 'highlight':
      case 'border':
      case 'spotlight':      return `要框出 ${target},確認嗎?`;
      case 'wait':
      case 'wait_for':       return '要稍等一下,確認嗎?';
      default:               return targetSel
        ? `下一步:${actionName} → ${target},確認嗎?`
        : `下一步:${actionName},確認嗎?`;
    }
  }
  // English (default).
  switch (actionName) {
    case 'navigate':       return `Navigate to ${trim(str('path'))} — proceed?`;
    case 'click':          return `Click ${target} — proceed?`;
    case 'fill_input':
    case 'set_text':       return `Fill ${target} with "${trim(str('value') || str('text'), 28)}" — proceed?`;
    case 'scroll_to':      return `Scroll to ${target} — proceed?`;
    case 'submit_form':    return `Submit form ${target} — proceed?`;
    case 'select_option':  return `Select "${trim(str('value'), 28)}" — proceed?`;
    case 'highlight':
    case 'border':
    case 'spotlight':      return `Frame ${target} — proceed?`;
    case 'wait':
    case 'wait_for':       return 'Wait a moment — proceed?';
    default:               return targetSel
      ? `Next: ${actionName} → ${target} — proceed?`
      : `Next: ${actionName} — proceed?`;
  }
}

/**
 * Turn a raw CSS selector into a human-friendly element description by
 * reading the matched element's visible text. Returns `null` if we can't
 * find a non-empty label — caller falls back to the raw selector.
 *
 * Priority:
 *  1. The element's own `aria-label` / `title` (if it's purpose-y).
 *  2. The element's `innerText`, trimmed and truncated.
 *  3. The element's tag name in friendlier form (e.g. "the form").
 */
function describeElement(selector?: string): string | null {
  if (!selector) return null;
  if (typeof document === 'undefined') return null;
  let el: Element | null = null;
  try { el = document.querySelector(selector); } catch { return null; }
  if (!el) return null;
  const aria = el.getAttribute('aria-label') ?? el.getAttribute('title');
  if (aria && aria.trim()) return `「${truncate(aria.trim(), 28)}」`;
  const text = (el as HTMLElement).innerText?.trim() ?? el.textContent?.trim();
  if (text) return `「${truncate(text, 28)}」`;
  return null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
