/**
 * Markdown artifact — in-memory CRUD for `MarkdownDoc`s. Not used by the
 * webagent loop; exposed so hosts can build LLM-mediated authoring
 * surfaces (meeting notes, drafts, KB articles) on top of the same
 * Plan instance / storage adapter.
 *
 * Two edit paths:
 *   - `edit(id, content)` — direct overwrite (host-driven, no LLM)
 *   - `editWithInstruction(id, instruction)` — LLM-mediated rewrite; uses
 *     the Plan instance's LLM. Returns the new doc.
 *
 * `id` scheme matches `TodosArtifact` — short stable `m1`, `m2`, ...
 */

import type { LLMProvider } from '../llm/types';
import type { MarkdownDoc } from './types';

const MARKDOWN_EDIT_SYSTEM_PROMPT = `You are a markdown editing assistant. The user provides the current document and an instruction. Rewrite the document to satisfy the instruction. Reply with ONLY the new markdown content — no surrounding prose, no code fences, no commentary. Preserve sections / formatting the instruction did not touch.`;

export interface MarkdownArtifactOptions {
  /** LLM provider used for `editWithInstruction`. Optional — without it
   *  the LLM-mediated edit method throws. Direct `edit()` always works. */
  llm?: LLMProvider;
  /** Optional change hook. Fires after every mutation with the new list. */
  onChange?: (docs: MarkdownDoc[]) => void;
  /** Seed docs — used when restoring from a storage adapter. */
  initial?: MarkdownDoc[];
  initialIdCounter?: number;
}

export class MarkdownArtifact {
  private docs: MarkdownDoc[] = [];
  private idCounter: number;
  private readonly llm?: LLMProvider;
  private readonly onChange?: (docs: MarkdownDoc[]) => void;

  constructor(opts: MarkdownArtifactOptions = {}) {
    this.llm = opts.llm;
    this.onChange = opts.onChange;
    this.docs = [...(opts.initial ?? [])];
    this.idCounter = opts.initialIdCounter ?? this.docs.length;
  }

  list(): MarkdownDoc[] {
    return this.docs.map((d) => ({ ...d }));
  }

  read(id: string): MarkdownDoc | null {
    const found = this.docs.find((d) => d.id === id);
    return found ? { ...found } : null;
  }

  create(input: { title: string; content: string }): MarkdownDoc {
    const id = `m${++this.idCounter}`;
    const doc: MarkdownDoc = { id, title: input.title, content: input.content, updatedAt: Date.now() };
    this.docs.push(doc);
    this.notify();
    return { ...doc };
  }

  /** Direct overwrite — host knows what content to write. */
  edit(id: string, patch: Partial<{ title: string; content: string }>): MarkdownDoc | null {
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx < 0) return null;
    const next: MarkdownDoc = { ...this.docs[idx]!, ...patch, updatedAt: Date.now() };
    this.docs[idx] = next;
    this.notify();
    return { ...next };
  }

  /** LLM-mediated rewrite — pass an instruction, the model returns new
   *  content. Throws if no LLM was configured. */
  async editWithInstruction(id: string, instruction: string): Promise<MarkdownDoc | null> {
    if (!this.llm) {
      throw new Error('MarkdownArtifact: editWithInstruction requires an LLM provider at construct time');
    }
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return null;
    const result = await this.llm.complete({
      messages: [
        { role: 'system', content: MARKDOWN_EDIT_SYSTEM_PROMPT },
        { role: 'user', content: `# Current document\n\n${doc.content}\n\n# Instruction\n\n${instruction}` },
      ],
      thinking: 'off',
      temperature: 0.2,
    });
    return this.edit(id, { content: result.content.trim() });
  }

  delete(id: string): boolean {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => d.id !== id);
    const removed = this.docs.length < before;
    if (removed) this.notify();
    return removed;
  }

  serialize(): { docs: MarkdownDoc[]; idCounter: number } {
    return {
      docs: this.docs.map((d) => ({ ...d })),
      idCounter: this.idCounter,
    };
  }

  private notify(): void {
    if (this.onChange) this.onChange(this.list());
  }
}
