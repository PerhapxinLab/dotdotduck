/**
 * Tiny typed event emitter — no node:events dependency, works in any environment.
 */

import type { AgentEventName, AgentEventMap, AgentEventHandler } from './types';

export class TypedEmitter {
  private handlers: Map<AgentEventName, Set<AgentEventHandler<AgentEventName>>> = new Map();
  /**
   * Reentrancy guard: prevents an `error` event from triggering an infinite
   * loop if an error listener itself throws.
   */
  private inErrorEmit = false;

  on<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as AgentEventHandler<AgentEventName>);
  }

  off<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): void {
    this.handlers.get(event)?.delete(handler as AgentEventHandler<AgentEventName>);
  }

  emit<E extends AgentEventName>(event: E, payload: AgentEventMap[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as AgentEventHandler<E>)(payload);
      } catch (err) {
        // Surface listener exceptions via the typed `error` channel where
        // hosts already expect them. Fall back to console only if no error
        // handlers are registered, or if we're already mid-error-emit
        // (recursion guard).
        const errorSet = this.handlers.get('error');
        if (event !== 'error' && !this.inErrorEmit && errorSet && errorSet.size > 0) {
          this.inErrorEmit = true;
          try {
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
          } finally {
            this.inErrorEmit = false;
          }
        } else {
          // Never let a bad listener kill the agent loop.
          console.error('[webagent] event handler error:', err);
        }
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
