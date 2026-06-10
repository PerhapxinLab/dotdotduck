/**
 * Per-run intent bookkeeping.
 *
 * A "run" is one user query and everything that follows it — narrations,
 * tool calls, confirms, pauses, until the loop ends (final / stopped).
 * We give it an id at start time and buffer every intent emitted while
 * it's active. Hosts call `exportAgentRun()` to get the whole thing
 * (session + intents) as one JSON blob.
 */

import type { AgentSession } from '../agent/webagent/types';
import type { IntentEvent } from '../types';
import type { TypedEmitter } from '../event-emitter';

export class IntentBuffer {
  private _currentRunId: string | null = null;
  private _currentRunIntents: IntentEvent[] = [];
  /**
   * Active skill id while a skill is running. Set on skill_started and
   * cleared on skill_finished. Read by `renderLoopClosure` so the
   * `agent_feedback` IntentEvent can attribute satisfaction back to the
   * skill that triggered the run — enables per-skill quality breakdown
   * on the dashboard without after-the-fact time-window heuristics.
   */
  currentSkillId: string | null = null;

  get currentRunId(): string | null { return this._currentRunId; }
  get currentRunIntents(): IntentEvent[] { return this._currentRunIntents; }

  /** Emit + buffer. Routes through the host's TypedEmitter, then appends
   *  to the active run if any. */
  emitIntent(emitter: TypedEmitter, event: IntentEvent): void {
    emitter.emit('intent', event);
    // Buffer into the current run so `exportAgentRun()` returns the full
    // sequence of decisions alongside the session turn log. We accept
    // anything emitted between `beginAgentRun` and the next one — that
    // includes confirm gates, ask_user answers, pause decisions, etc.
    if (this._currentRunId) this._currentRunIntents.push(event);
  }

  beginAgentRun(emitter: TypedEmitter, task: string, sessionId: string): void {
    this._currentRunId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this._currentRunIntents = [];
    this.emitIntent(emitter, {
      kind: 'agent_run_started',
      runId: this._currentRunId,
      task,
      sessionId,
      timestamp: Date.now(),
    });
  }

  endAgentRunCompleted(emitter: TypedEmitter, sessionId: string, turnCount: number): void {
    if (!this._currentRunId) return;
    this.emitIntent(emitter, {
      kind: 'agent_run_completed',
      runId: this._currentRunId,
      sessionId,
      turnCount,
      timestamp: Date.now(),
    });
    // Keep runId / intents around until next run starts so an
    // `exportAgentRun()` call right after the loop ends still works.
  }

  endAgentRunStopped(
    emitter: TypedEmitter,
    sessionId: string,
    reason: 'close' | 'esc' | 'reject' | 'palette' | 'voice' | 'unknown',
  ): void {
    if (!this._currentRunId) return;
    this.emitIntent(emitter, {
      kind: 'agent_run_stopped',
      runId: this._currentRunId,
      sessionId,
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * Snapshot the current (or most-recent) agent run as a single JSON
   * blob — session turns + every intent emitted during the run. Useful
   * for shipping a complete query record to a dashboard / DB after the
   * loop ends. Returns `null` if no session is provided.
   */
  exportAgentRun(session: AgentSession | null | undefined): {
    runId: string;
    sessionId: string;
    session: AgentSession;
    intents: IntentEvent[];
    exportedAt: number;
  } | null {
    if (!session) return null;
    return {
      runId: this._currentRunId ?? '',
      sessionId: session.id,
      session: JSON.parse(JSON.stringify(session)) as AgentSession,
      intents: this._currentRunIntents.slice(),
      exportedAt: Date.now(),
    };
  }
}
