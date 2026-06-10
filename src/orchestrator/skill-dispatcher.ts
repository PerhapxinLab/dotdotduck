/**
 * Skill dispatch — looks up a skill by id / slash command, gates on
 * preferences, then routes by skill type (script / prompt / action /
 * surface / panel). Also owns the ad-hoc surface tools (`showSurface
 * AndAwait` / `submitSurface` / `cancelSurface`) used by ScriptSkill
 * steps and host code.
 *
 * Wrapped as a helper class taking the `DotDotDuck` host so it can
 * reach into `_prefs`, `_pendingSurface`, etc., without leaking a
 * second public type into the SDK surface.
 */

import type { PaletteItem } from '../triggers/command-palette';
import type { Skill, ScriptSkill, ActionSkillContext, SkillTools, SurfacePlacement } from '../skills/types';
import type { DotDotDuck } from './index';

export class SkillDispatcher {
  constructor(private readonly host: DotDotDuck) {}

  async runSkill(idOrCommand: string, vars: Record<string, string> = {}): Promise<void> {
    const host = this.host;
    const skill = host.skills.match(idOrCommand) ?? host.skills.get(idOrCommand);
    if (!skill) return;

    // Preferences gate — if any required pref missing, render setup surface first.
    if (skill.preferences && skill.preferences.length > 0) {
      const schema = { skillId: skill.id, fields: skill.preferences };
      const ctx = host._prefs.contextFor(schema);
      if (!ctx.isComplete()) {
        const surface = host._prefs.buildSetupSurface(schema);
        const ok = await new Promise<boolean>((resolve) => {
          host._pendingPrefs = {
            skillId: skill.id,
            resolve: () => {
              host._pendingPrefs = null;
              resolve(true);
            },
            reject: () => {
              host._pendingPrefs = null;
              resolve(false);
            },
          };
          host._emitter.emit('surface', { surface, placement: 'modal' });
        });
        if (!ok || !ctx.isComplete()) return;
      }
    }

    host._emitter.emit('skill_start', { skillId: skill.id });
    host._intentBuffer.emitIntent(host._emitter, {
      kind: 'skill_started', skillId: skill.id, timestamp: Date.now(),
    });
    host._intentBuffer.currentSkillId = skill.id;

    try {
      switch (skill.type) {
        case 'script':
          await this.runScriptSkill(skill);
          break;
        case 'prompt': {
          const args = host.skills.parseArgs(idOrCommand);
          const merged = args ? { ...vars, args } : vars;
          const prompt = host.skills.resolvePrompt(skill, merged);
          host.startAgent(prompt);
          break;
        }
        case 'action':
          await skill.handler(this.buildActionContext(skill.id));
          break;
        case 'surface': {
          const surface = await skill.build(this.buildActionContext(skill.id));
          host._emitter.emit('surface', { surface, placement: 'modal' });
          // Host listens to the `surface` event and calls onSubmit upon submission.
          break;
        }
        case 'panel': {
          await host._ensurePanelRuntime().enter(skill);
          break;
        }
      }
    } finally {
      host._emitter.emit('skill_done', { skillId: skill.id });
      host._intentBuffer.emitIntent(host._emitter, {
        kind: 'skill_finished', skillId: skill.id, timestamp: Date.now(),
      });
      if (host._intentBuffer.currentSkillId === skill.id) host._intentBuffer.currentSkillId = null;
    }
  }

  // ─── helpers ────────────────────────────────────────────────────

  private async runScriptSkill(skill: ScriptSkill): Promise<void> {
    const host = this.host;
    let i = 0;
    try {
      for (const step of skill.steps) {
        host._emitter.emit('skill_step', { skillId: skill.id, stepIndex: i });

        if (step.page) host._navigate(step.page);
        if (step.subtitle) {
          host.subtitle.show({ text: step.subtitle, type: 'agent' });
        }
        if (step.action) {
          await step.action(this.buildSkillTools());
        }
        if (step.waitForUser !== false) {
          const outcome = await this.waitForAcceptOrEscape();
          // Esc OR double-tap space both exit the tour early — double-tap
          // is the canonical "no/dismiss" gesture and should behave like Esc.
          if (outcome !== 'accept') {
            break;
          }
        }
        host.subtitle.hide();
        i++;
      }
    } finally {
      // Every exit path (normal completion, user double-tap exit, esc,
      // thrown step) clears ALL agent / tour surface state. Without this
      // the last subtitle / streaming indicator / highlight could linger
      // and the user thinks the agent is still working when the tour
      // actually ended. Belt-and-braces — individual break paths used
      // to clear partially; centralising it here means there is exactly
      // one "skill is over" cleanup contract.
      host.subtitle.hide();
      host.subtitle.hideIndicator();
      host._highlight.clearHighlight();
      // If a webagent loop happened to be running alongside the script
      // (rare — host might have started one for unrelated work), stop it
      // so the user's idea of "the tour ended" matches reality. Safe
      // no-op when no agent is running.
      try { host.stopAgent(); } catch { /* swallow */ }
    }
  }

  /**
   * Resolves on the next user gesture:
   *   - `'accept'`  → single space tap or accept-button click
   *   - `'escape'`  → Esc key
   *   - `'reject'`  → double space tap (treated as exit by ScriptSkill)
   *
   * Callers can branch on the outcome to advance vs. bail out of a
   * multi-step flow.
   */
  private waitForAcceptOrEscape(): Promise<'accept' | 'escape' | 'reject'> {
    const host = this.host;
    return new Promise((resolve) => {
      const cleanup = () => {
        host.off('gesture_accept', onAccept);
        host.off('gesture_escape', onEsc);
        host.off('gesture_reject', onReject);
      };
      const onAccept = () => { cleanup(); resolve('accept'); };
      const onEsc    = () => { cleanup(); resolve('escape'); };
      const onReject = () => { cleanup(); resolve('reject'); };
      host.on('gesture_accept', onAccept);
      host.on('gesture_escape', onEsc);
      host.on('gesture_reject', onReject);
    });
  }

  buildSkillTools(): SkillTools {
    const host = this.host;
    return {
      navigate: (path) => host._navigate(path),
      // All three overlay primitives map to the same Dwell-style frame —
      // visual consistency with long-press selection. `color` / `label`
      // params are accepted but currently ignored; the frame is themed via
      // `--dddk-dwell-frame-*` CSS vars on the host.
      highlight: (selector) => { host.highlightElement(selector); return selector; },
      border:    (selector) => { host.highlightElement(selector); return selector; },
      spotlight: (selector) => { host.highlightElement(selector); return selector; },
      inject: () => '',
      subtitle: (text) => host.subtitle.show({ text, type: 'agent' }),
      clearOverlays: () => host.clearHighlight(),
      ask: async () => '',
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      surface: (surface, opts) => this.showSurfaceAndAwait(surface, opts?.placement ?? 'modal'),
    };
  }

  /**
   * Show a Surface and await the host's submission. Used by skill tools and
   * any host code that wants the same "emit → user fills → resolve" pattern.
   */
  showSurfaceAndAwait(
    surface: unknown,
    placement: SurfacePlacement = 'modal',
  ): Promise<Record<string, unknown> | null> {
    const host = this.host;
    // If something is already pending, cancel it before starting a new one —
    // surfaces are modal-ish; two at once would deadlock the script.
    if (host._pendingSurface) {
      host._pendingSurface.resolve(null);
      host._pendingSurface = null;
    }
    return new Promise((resolve) => {
      host._pendingSurface = {
        resolve: (data) => {
          host._pendingSurface = null;
          resolve(data);
        },
      };
      host._emitter.emit('surface', { surface, placement });
    });
  }

  /**
   * Host calls this when the user submits the active Surface form. Routes
   * to whichever subsystem opened the surface:
   *   - If a ScriptSkill called `tools.surface(...)` → resolves that promise
   *   - If webagent was awaiting a host interaction → resumes the agent loop
   * (Both can be pending at once in theory — we resolve both for safety.)
   */
  submitSurface(data: Record<string, unknown>): void {
    const host = this.host;
    if (host._pendingSurface) {
      host._pendingSurface.resolve(data);
    }
    host._agentInstance?.respond(data);
  }

  /** Host calls this when the user cancels the Surface (Esc / backdrop click). */
  cancelSurface(): void {
    const host = this.host;
    if (host._pendingSurface) {
      host._pendingSurface.resolve(null);
    }
    // Tell webagent the user cancelled — it gets an empty answer.
    host._agentInstance?.respond('');
  }

  buildActionContext(skillId?: string): ActionSkillContext {
    const host = this.host;
    return {
      getPreferences<T = Record<string, unknown>>(): T {
        if (!skillId) return {} as T;
        return host._prefs.read(skillId) as T;
      },
      palette: {
        close: () => host.palette.close(),
        replace: (items) =>
          host.palette.setItems(items.map((i) => ({ id: i.id, name: i.name, handler: i.handler }))),
      },
      subtitle: {
        show: (opts) =>
          host.subtitle.show({
            text: opts.text,
            type: (opts.type as never) ?? 'info',
            autoHide: opts.autoHide,
          }),
        hide: () => host.subtitle.hide(),
      },
      storage: {
        get: <T,>(key: string) => {
          const raw = host._storage.get(key);
          if (raw == null) return null;
          const s = raw as string;
          try {
            return JSON.parse(s) as T;
          } catch {
            return s as unknown as T;
          }
        },
        set: (key, value) => {
          host._storage.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        },
      },
      agent: (task) => host.startAgent(task),
      navigate: (path) => host._navigate(path),
    };
  }

  buildPaletteItems(): PaletteItem[] {
    const host = this.host;
    const items: PaletteItem[] = [];

    for (const skill of host.skills.list()) {
      // Skills marked `hidden: true` are still callable (host can fire
      // them via `dddk.runSkill(id)` or wire their own palette items
      // pointing at them), but they don't auto-appear in the default
      // "Skills" section. Use this when you want explicit control over
      // section / placement / labelling in the palette.
      if (skill.hidden) continue;
      // If skill.name already looks like `/command`, use it as-is to avoid
      // duplication ("/introduce — /introduce"). Otherwise prefix `/<id>` so
      // the palette can route the slash command, and append name for context.
      const looksLikeSlashCommand = skill.name.trim().startsWith('/');
      const displayName = looksLikeSlashCommand
        ? skill.name
        : `/${skill.id} — ${skill.name}`;
      items.push({
        id: skill.id,
        name: displayName,
        description: skill.description,
        section: 'Skills',
        // No `icon` field — skills are intentionally rendered without icons
        // in the palette (host-defined PaletteItems can opt in via their own
        // `icon` field; skills stay neutral so they read as text actions).
        handler: (h) => {
          h.close();
          host.runSkill(skill.id);
        },
      });
    }

    for (const cmd of host._config.paletteCommands ?? []) {
      items.push(cmd);
    }

    return items;
  }
}

// Helper — extract Skill from a skills.list() entry without depending on
// the host. Exists so test code can drive `buildPaletteItems` without a
// full DotDotDuck instance.
export type { Skill };
