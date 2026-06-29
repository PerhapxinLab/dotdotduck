// InlineChatSession — minimal turn history for "follow-up" inline edits.
// Keeps original selection + every (instruction, result) round, so a follow-up
// prompt can reference prior context. The transport (LLM call) is host-supplied;
// the session is just a state container.

export interface InlineChatTurn {
  /** User prompt for this turn ('improve writing' for the initial, follow-ups thereafter). */
  prompt: string;
  /** AI text after this turn. */
  result: string;
}

export interface InlineChatSendArgs {
  /** The original text the user selected (never changes across the session). */
  original: string;
  /** Every turn so far, oldest first. */
  history: InlineChatTurn[];
  /** The latest user prompt. */
  prompt: string;
}

export type InlineChatTransport = (args: InlineChatSendArgs) => Promise<string | null>;

export class InlineChatSession {
  private readonly transport: InlineChatTransport;
  private readonly original: string;
  private readonly history: InlineChatTurn[] = [];

  constructor(original: string, transport: InlineChatTransport) {
    this.original = original;
    this.transport = transport;
  }

  /** Current best result (the last turn's text, or the original if nothing yet). */
  current(): string {
    const last = this.history[this.history.length - 1];
    return last ? last.result : this.original;
  }

  /** Send a follow-up prompt; on success records the turn and returns the new
   *  text. Returns null on transport failure. */
  async send(prompt: string): Promise<string | null> {
    const result = await this.transport({
      original: this.original,
      history: this.history.slice(),
      prompt,
    });
    if (result == null) return null;
    this.history.push({ prompt, result });
    return result;
  }

  /** Recorded turns (immutable copy). */
  turns(): InlineChatTurn[] {
    return this.history.slice();
  }
}
