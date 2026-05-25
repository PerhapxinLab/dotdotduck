import type { DddkEventName, DddkEventMap, DddkEventHandler } from './types';

export class TypedEmitter {
  private handlers: Map<DddkEventName, Set<DddkEventHandler<DddkEventName>>> = new Map();

  on<E extends DddkEventName>(event: E, handler: DddkEventHandler<E>): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as DddkEventHandler<DddkEventName>);
  }

  off<E extends DddkEventName>(event: E, handler: DddkEventHandler<E>): void {
    this.handlers.get(event)?.delete(handler as DddkEventHandler<DddkEventName>);
  }

  emit<E extends DddkEventName>(event: E, payload: DddkEventMap[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        (h as DddkEventHandler<E>)(payload);
      } catch (err) {
        console.error('[dddk] event handler error:', err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
