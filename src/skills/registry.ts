/**
 * SkillRegistry — register / lookup / match skills by id or `/command`.
 */

import type { Skill, PromptSkill } from './types';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor(initial: Skill[] = []) {
    for (const s of initial) this.skills.set(s.id, s);
  }

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  unregister(id: string): void {
    this.skills.delete(id);
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(): Skill[] {
    return Array.from(this.skills.values()).filter((s) => !s.hidden);
  }

  listAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** Match palette input like `/introduce` or `/translate en` to a skill id. */
  match(input: string): Skill | undefined {
    const id = input.startsWith('/') ? input.slice(1).split(/\s+/)[0] : input.split(/\s+/)[0];
    return id ? this.skills.get(id) : undefined;
  }

  /** Extract args after the skill name. e.g. `/translate en` → 'en' */
  parseArgs(input: string): string {
    const parts = (input.startsWith('/') ? input.slice(1) : input).split(/\s+/);
    return parts.slice(1).join(' ');
  }

  /** Resolve `{{var}}` placeholders in a PromptSkill template. */
  resolvePrompt(skill: PromptSkill, vars: Record<string, string> = {}): string {
    const merged = { ...skill.variables, ...vars };
    let out = skill.prompt;
    for (const [k, v] of Object.entries(merged)) {
      out = out.replace(new RegExp(`\\{\\{\\s*${escapeRegex(k)}\\s*\\}\\}`, 'g'), v);
    }
    return out;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
