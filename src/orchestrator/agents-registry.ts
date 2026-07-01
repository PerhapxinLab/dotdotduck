/**
 * `dddk.agents` — named agent registry + active-agent slot.
 *
 * Hosts wiring multiple agents (different prompts / sitemaps /
 * personas per route) register each one by name; the orchestrator
 * routes the "current" agent's calls (palette commands, voice
 * captures, dwell selections) through whatever the host has set
 * active. Switching active on a route change preserves cross-page
 * continuity when the agents share a session via `dddk.sessions`.
 *
 * Holds WebAgent instances today; TaskAgent slots in via the same
 * interface
 *
 * v0.2.0.
 */

import type { WebAgent } from '../agent';

/**
 * Minimum the orchestrator + registry needs from any registered
 * agent. WebAgent satisfies this naturally; TaskAgent will once
 * 
 */
export interface RegisterableAgent {
  isRunning?(): boolean;
  stop?(): void;
  destroy?(): void;
  setLocale?(locale: string): void;
}

export class AgentsRegistry {
  private map = new Map<string, WebAgent>();
  private activeName: string | null = null;

  /**
   * Register an agent under `name`. If `name` is already registered
   * the previous entry is replaced; the previous agent's `destroy()`
   * is NOT called automatically — host owns the lifecycle.
   *
   * The first register call also becomes the active agent unless
   * another was already set.
   */
  register(name: string, agent: WebAgent): void {
    this.map.set(name, agent);
    if (this.activeName === null) this.activeName = name;
  }

  /**
   * Remove an agent from the registry. If it was the active one,
   * clears the active slot (host must `setActive` again).
   */
  unregister(name: string): void {
    this.map.delete(name);
    if (this.activeName === name) this.activeName = null;
  }

  /** Lookup by name. Returns `undefined` when not registered. */
  get(name: string): WebAgent | undefined {
    return this.map.get(name);
  }

  /** True when the registry has an agent under this name. */
  has(name: string): boolean {
    return this.map.has(name);
  }

  /** All registered agent names. */
  list(): string[] {
    return Array.from(this.map.keys());
  }

  /**
   * Make `name` the active agent. Throws when no agent is registered
   * under that name — silently swallowing would mask host config
   * bugs that are otherwise hard to spot.
   */
  setActive(name: string): void {
    if (!this.map.has(name)) {
      throw new Error(`AgentsRegistry.setActive: no agent registered under '${name}'`);
    }
    this.activeName = name;
  }

  /** Currently-active agent. `null` when nothing is registered. */
  getActive(): WebAgent | null {
    if (!this.activeName) return null;
    return this.map.get(this.activeName) ?? null;
  }

  /** Name of the active agent, or `null` if unset. */
  getActiveName(): string | null {
    return this.activeName;
  }
}
