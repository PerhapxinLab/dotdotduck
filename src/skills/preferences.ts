/**
 * Skill preferences — declarative per-skill settings.
 *
 * When a skill declares preferences, dddk:
 *   1. Refuses to run the skill until all `required: true` prefs are filled.
 *   2. Auto-renders a setup form (as a Surface) the first time.
 *   3. Stores values keyed by skill id via the dddk StorageAdapter.
 *   4. Provides `ctx.getPreferences<T>()` inside the skill handler.
 */

import type { StorageAdapter } from '../types';
import { sdkString } from '../utils/sdk-i18n';

export type PreferenceKind = 'text' | 'password' | 'number' | 'checkbox' | 'select';

export interface PreferenceField {
  name: string;
  title: string;
  kind: PreferenceKind;
  description?: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  /** For 'select' kind. */
  options?: Array<{ value: string; label: string }>;
}

export interface PreferenceSchema {
  skillId: string;
  fields: PreferenceField[];
}

export interface PreferenceContext {
  get<T = Record<string, unknown>>(): T;
  set(values: Record<string, unknown>): void;
  isComplete(): boolean;
  missingRequired(): PreferenceField[];
}

export class PreferenceStore {
  constructor(private storage: StorageAdapter, private locale?: string) {}

  private keyOf(skillId: string): string {
    return `prefs.${skillId}`;
  }

  read(skillId: string): Record<string, unknown> {
    const raw = this.storage.get(this.keyOf(skillId));
    if (raw == null) return {};
    const value = raw as string;
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  write(skillId: string, values: Record<string, unknown>): void {
    this.storage.set(this.keyOf(skillId), JSON.stringify(values));
  }

  remove(skillId: string): void {
    this.storage.remove(this.keyOf(skillId));
  }

  contextFor(schema: PreferenceSchema): PreferenceContext {
    const self = this;
    return {
      get<T>() {
        return self.read(schema.skillId) as T;
      },
      set(values: Record<string, unknown>) {
        const merged = { ...self.read(schema.skillId), ...values };
        self.write(schema.skillId, merged);
      },
      isComplete() {
        const cur = self.read(schema.skillId);
        return schema.fields
          .filter((f) => f.required)
          .every((f) => cur[f.name] !== undefined && cur[f.name] !== '');
      },
      missingRequired() {
        const cur = self.read(schema.skillId);
        return schema.fields.filter(
          (f) => f.required && (cur[f.name] === undefined || cur[f.name] === '')
        );
      },
    };
  }

  /** Build a Surface (flat envelope shape) representing the setup form. */
  buildSetupSurface(schema: PreferenceSchema): {
    version: 'v0.10';
    updateComponents: {
      surfaceId: string;
      catalogId: string;
      components: Array<Record<string, unknown>>;
    };
    updateDataModel: { data: Record<string, unknown> };
  } {
    const components: Array<Record<string, unknown>> = [
      { id: 'root', component: 'Card', children: ['title', 'form'] },
      { id: 'title', component: 'Heading', text: sdkString(this.locale, 'prefs.title', { skill: schema.skillId }) },
      {
        id: 'form',
        component: 'Stack',
        children: [...schema.fields.map((f) => f.name), 'submit'],
      },
    ];

    for (const field of schema.fields) {
      components.push(buildFieldComponent(field));
    }
    components.push({ id: 'submit', component: 'Button', text: sdkString(this.locale, 'form.submit'), action: 'submit' });

    const data: Record<string, unknown> = {};
    const existing = this.read(schema.skillId);
    for (const f of schema.fields) {
      data[f.name] = existing[f.name] ?? f.default ?? '';
    }

    return {
      version: 'v0.10',
      updateComponents: { surfaceId: `prefs:${schema.skillId}`, catalogId: 'basic', components },
      updateDataModel: { data },
    };
  }
}

function buildFieldComponent(f: PreferenceField): Record<string, unknown> {
  switch (f.kind) {
    case 'text':
    case 'password':
      return {
        id: f.name,
        component: 'TextField',
        label: f.title,
        placeholder: f.placeholder,
        bind: `/${f.name}`,
      };
    case 'number':
      return { id: f.name, component: 'TextField', label: f.title, bind: `/${f.name}` };
    case 'checkbox':
      return { id: f.name, component: 'Checkbox', label: f.title, bind: `/${f.name}` };
    case 'select':
      return {
        id: f.name,
        component: 'Picker',
        label: f.title,
        bind: `/${f.name}`,
        options: (f.options ?? []).map((o) => o.value),
      };
  }
}
