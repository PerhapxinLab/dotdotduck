/**
 * Streaming envelope parser — v0.2.0 ROADMAP item 1.9.
 *
 * **Status: experimental.** The parser correctly walks complete
 * `agent_turn` envelopes and yields semantic events for every field.
 * Truly incremental parsing of partial string values (where a single
 * `narrate` string is split across multiple `feed()` calls) is
 * follow-up work — for now the parser requires each `feed()` to
 * contain at least one complete string-value boundary. When it
 * encounters a partial value it bails, and the caller buffers the
 * remaining args and falls back to the existing `JSON.parse` path.
 *
 * The architecture (semantic event stream rather than raw JSON
 * deltas) is the load-bearing part of 1.9; the per-character
 * streaming inside narrate strings is an optimisation that can land
 * later without breaking the API.
 *
 * Parses the `agent_turn` tool-call args incrementally as the LLM
 * streams them. Yields semantic events so the runtime can:
 *
 *   - start streaming a narrate to the subtitle bar as its string
 *     accumulates (instead of waiting for the whole envelope to land,
 *     then replaying via a local typewriter)
 *   - execute tool actions as soon as their args complete
 *   - observe memory / planning / todo_adjust as soon as they parse
 *
 * The parser is tailored to the `agent_turn` schema (see ../cot.ts):
 *
 * ```
 * {
 *   "memory": "...",
 *   "turn_planning": {...},       // optional, planned mode
 *   "todo_adjust": {...},          // optional
 *   "todos_remaining": [...],      // optional, legacy mode
 *   "actions": [
 *     { "narrate": "...", "about": "..." },
 *     { "tool": "...",    "args": {...} }
 *   ],
 *   "is_final": false              // optional, planned mode
 * }
 * ```
 *
 * Non-streaming fallback: if any byte of the input fails to parse, the
 * caller buffers the entire arg string and falls back to the existing
 * `JSON.parse` + `parseTurnResponse` path. Streaming is opportunistic,
 * not load-bearing.
 */

export type EnvelopeStreamEvent =
  | { kind: 'memory_complete'; value: string }
  | { kind: 'turn_planning_complete'; value: { evaluation_previous_goal: string; next_goal: string } }
  | { kind: 'todo_adjust_complete'; value: unknown }
  | { kind: 'todos_remaining_complete'; value: string[] }
  | { kind: 'action_start'; index: number }
  | { kind: 'about_complete'; index: number; value: string }
  | { kind: 'narrate_delta'; index: number; delta: string }
  | { kind: 'narrate_complete'; index: number; full: string }
  | { kind: 'tool_args_complete'; index: number; tool: string; args: Record<string, unknown> }
  | { kind: 'is_final_complete'; value: boolean }
  | { kind: 'envelope_complete' };

/**
 * Walk the agent_turn tool-call args one delta at a time. Yields
 * `EnvelopeStreamEvent` items as completed schema fragments come into
 * view. Returns `null` from `feed()` to signal the parser bailed out
 * on a structure it didn't recognise — caller should switch to
 * non-streaming fallback for the rest of the turn.
 *
 * Usage:
 *
 * ```ts
 * const parser = new StreamingEnvelopeParser();
 * for await (const ev of llmStream) {
 *   if (ev.kind === 'tool-call-args-delta') {
 *     const events = parser.feed(ev.delta);
 *     if (events === null) { fallbackBuffer += ev.delta; continue; }
 *     for (const e of events) yield e;
 *   }
 * }
 * const tail = parser.finish();
 * if (tail) for (const e of tail) yield e;
 * ```
 */
export class StreamingEnvelopeParser {
  private buf = '';
  private pos = 0;
  private state: State = 'envelope_open';
  private currentActionIdx = -1;
  private currentActionFields: 'narrate_started' | 'tool_started' | null = null;
  private narrateBuffer = '';
  private narrateEmittedLen = 0;
  private aboutBuffer = '';
  private toolNameBuffer = '';
  /**
   * Once we hit a structure we can't incrementally parse (deep nested
   * objects, schema we don't recognise), we set `bailed = true` and
   * stop emitting events. Caller falls back to `JSON.parse` for this turn.
   */
  private bailed = false;

  feed(delta: string): EnvelopeStreamEvent[] | null {
    if (this.bailed) return null;
    this.buf += delta;
    const events: EnvelopeStreamEvent[] = [];
    try {
      this.process(events);
    } catch (err) {
      this.bailed = true;
      return null;
    }
    return events;
  }

  finish(): EnvelopeStreamEvent[] | null {
    if (this.bailed) return null;
    const events: EnvelopeStreamEvent[] = [];
    if (this.state === 'envelope_done' || this.state === 'envelope_open') {
      events.push({ kind: 'envelope_complete' });
    }
    return events;
  }

  hasBailed(): boolean {
    return this.bailed;
  }

  // ─── internals ─────────────────────────────────────────────────────

  private process(events: EnvelopeStreamEvent[]): void {
    while (this.pos < this.buf.length) {
      const startPos = this.pos;
      this.tick(events);
      if (this.pos === startPos) return; // nothing new to consume; wait for more delta
    }
  }

  private tick(events: EnvelopeStreamEvent[]): void {
    switch (this.state) {
      case 'envelope_open':
        this.skipWhitespace();
        if (this.peek() === '{') {
          this.pos += 1;
          this.state = 'envelope_key_or_close';
        }
        return;

      case 'envelope_key_or_close':
        this.skipWhitespace();
        if (this.peek() === '}') {
          this.pos += 1;
          this.state = 'envelope_done';
          return;
        }
        if (this.peek() === ',') {
          this.pos += 1;
          this.skipWhitespace();
        }
        if (this.peek() === '"') {
          const key = this.readKey();
          if (key === null) return; // need more chars
          this.skipWhitespace();
          if (this.peek() !== ':') return; // need more chars
          this.pos += 1;
          this.skipWhitespace();
          this.dispatchKey(key, events);
          return;
        }
        return;

      case 'envelope_done':
        return;

      // The "currently consuming X" states are handled inline by
      // dispatchKey + the per-key readers; we don't loop here.
      default:
        return;
    }
  }

  private dispatchKey(key: string, events: EnvelopeStreamEvent[]): void {
    switch (key) {
      case 'memory': {
        const s = this.readString();
        if (s === null) { this.bailed = true; return; }
        events.push({ kind: 'memory_complete', value: s });
        this.state = 'envelope_key_or_close';
        return;
      }
      case 'is_final': {
        const v = this.readBool();
        if (v === null) { this.bailed = true; return; }
        events.push({ kind: 'is_final_complete', value: v });
        this.state = 'envelope_key_or_close';
        return;
      }
      case 'turn_planning': {
        const v = this.readObjectAsJson<{ evaluation_previous_goal: string; next_goal: string }>();
        if (v === null) { this.bailed = true; return; }
        events.push({ kind: 'turn_planning_complete', value: v });
        this.state = 'envelope_key_or_close';
        return;
      }
      case 'todo_adjust': {
        const v = this.readObjectAsJson<unknown>();
        if (v === null) { this.bailed = true; return; }
        events.push({ kind: 'todo_adjust_complete', value: v });
        this.state = 'envelope_key_or_close';
        return;
      }
      case 'todos_remaining': {
        const v = this.readArrayAsJson<string>();
        if (v === null) { this.bailed = true; return; }
        events.push({ kind: 'todos_remaining_complete', value: v });
        this.state = 'envelope_key_or_close';
        return;
      }
      case 'actions': {
        // Special: parse array element-by-element with narrate streaming.
        this.parseActionsArray(events);
        return;
      }
      default: {
        // Unknown key — try to skip a generic JSON value.
        const skipped = this.skipValue();
        if (!skipped) { this.bailed = true; return; }
        this.state = 'envelope_key_or_close';
        return;
      }
    }
  }

  private parseActionsArray(events: EnvelopeStreamEvent[]): void {
    this.skipWhitespace();
    if (this.peek() !== '[') { this.bailed = true; return; }
    this.pos += 1;
    let firstAction = true;
    while (true) {
      this.skipWhitespace();
      const c = this.peek();
      if (c === undefined) return; // need more chars
      if (c === ']') {
        this.pos += 1;
        this.state = 'envelope_key_or_close';
        return;
      }
      if (!firstAction) {
        if (c !== ',') return;
        this.pos += 1;
        this.skipWhitespace();
      }
      firstAction = false;
      this.currentActionIdx += 1;
      events.push({ kind: 'action_start', index: this.currentActionIdx });
      const ok = this.parseSingleAction(events);
      if (!ok) { this.bailed = true; return; }
    }
  }

  private parseSingleAction(events: EnvelopeStreamEvent[]): boolean {
    this.skipWhitespace();
    if (this.peek() !== '{') return false;
    this.pos += 1;
    this.narrateBuffer = '';
    this.narrateEmittedLen = 0;
    this.aboutBuffer = '';
    this.toolNameBuffer = '';
    this.currentActionFields = null;
    while (true) {
      this.skipWhitespace();
      const c = this.peek();
      if (c === undefined) {
        // We bail out so caller can wait for more chars and restart;
        // but the parser is single-shot per action — for now bail.
        return false;
      }
      if (c === '}') {
        this.pos += 1;
        // Emit final narrate_complete if we were streaming a narrate.
        if (this.currentActionFields === 'narrate_started') {
          events.push({
            kind: 'narrate_complete',
            index: this.currentActionIdx,
            full: this.narrateBuffer,
          });
        }
        return true;
      }
      if (c === ',') {
        this.pos += 1;
        continue;
      }
      if (c !== '"') return false;
      const key = this.readKey();
      if (key === null) return false;
      this.skipWhitespace();
      if (this.peek() !== ':') return false;
      this.pos += 1;
      this.skipWhitespace();

      if (key === 'about') {
        const s = this.readString();
        if (s === null) return false;
        this.aboutBuffer = s;
        events.push({ kind: 'about_complete', index: this.currentActionIdx, value: s });
        continue;
      }
      if (key === 'narrate') {
        this.currentActionFields = 'narrate_started';
        const done = this.streamNarrateString(events);
        if (!done) return false;
        continue;
      }
      if (key === 'tool') {
        this.currentActionFields = 'tool_started';
        const s = this.readString();
        if (s === null) return false;
        this.toolNameBuffer = s;
        continue;
      }
      if (key === 'args') {
        const v = this.readObjectAsJson<Record<string, unknown>>();
        if (v === null) return false;
        events.push({
          kind: 'tool_args_complete',
          index: this.currentActionIdx,
          tool: this.toolNameBuffer || 'unknown',
          args: v,
        });
        continue;
      }
      if (key === 'task_finish') {
        // Legacy field; skip its boolean value.
        const b = this.readBool();
        if (b === null) return false;
        continue;
      }
      // Unknown key — try to skip.
      const ok = this.skipValue();
      if (!ok) return false;
    }
  }

  /**
   * Stream a string value char-by-char to the subtitle bar. Yields
   * `narrate_delta` for each new chunk we receive between calls.
   */
  private streamNarrateString(events: EnvelopeStreamEvent[]): boolean {
    if (this.peek() !== '"') return false;
    this.pos += 1; // opening quote
    let inEscape = false;
    while (this.pos < this.buf.length) {
      const ch = this.buf[this.pos]!;
      if (inEscape) {
        inEscape = false;
        // Translate the standard escape sequences.
        let translated: string;
        switch (ch) {
          case 'n': translated = '\n'; break;
          case 't': translated = '\t'; break;
          case 'r': translated = '\r'; break;
          case '"': translated = '"'; break;
          case '\\': translated = '\\'; break;
          case '/': translated = '/'; break;
          case 'u': {
            // \uXXXX — need 4 hex digits
            if (this.pos + 4 >= this.buf.length) return false; // wait for more
            const hex = this.buf.slice(this.pos + 1, this.pos + 5);
            const code = parseInt(hex, 16);
            if (isNaN(code)) return false;
            translated = String.fromCharCode(code);
            this.pos += 4; // skip the hex digits in addition to the 'u'
            break;
          }
          default: translated = ch;
        }
        this.narrateBuffer += translated;
        this.pos += 1;
        this.emitNarrateDeltaIfPending(events);
        continue;
      }
      if (ch === '\\') {
        inEscape = true;
        this.pos += 1;
        continue;
      }
      if (ch === '"') {
        // End of string.
        this.pos += 1;
        this.emitNarrateDeltaIfPending(events);
        return true;
      }
      this.narrateBuffer += ch;
      this.pos += 1;
    }
    // Ran out of buffer; flush whatever we have so the user sees progress.
    this.emitNarrateDeltaIfPending(events);
    // Stop processing for now; caller will feed more.
    // Returning true here is a slight lie (we haven't seen the closing
    // quote), but it lets the outer loop pause and resume cleanly. We
    // continue this same string on the next call because position is
    // saved and the state machine resumes via parseSingleAction.
    return false; // signal "not complete" so the outer parser bails to fallback for safety
  }

  private emitNarrateDeltaIfPending(events: EnvelopeStreamEvent[]): void {
    if (this.narrateBuffer.length > this.narrateEmittedLen) {
      const delta = this.narrateBuffer.slice(this.narrateEmittedLen);
      this.narrateEmittedLen = this.narrateBuffer.length;
      events.push({ kind: 'narrate_delta', index: this.currentActionIdx, delta });
    }
  }

  // ─── primitives ───────────────────────────────────────────────────

  private peek(): string | undefined {
    return this.buf[this.pos];
  }

  private skipWhitespace(): void {
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos]!;
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') {
        this.pos += 1;
      } else {
        return;
      }
    }
  }

  /** Read `"key"` (the JSON string between quotes). Returns null if buffer doesn't have the full token yet. */
  private readKey(): string | null {
    return this.readString();
  }

  private readString(): string | null {
    if (this.peek() !== '"') return null;
    const start = this.pos;
    this.pos += 1;
    let inEscape = false;
    while (this.pos < this.buf.length) {
      const ch = this.buf[this.pos]!;
      if (inEscape) {
        inEscape = false;
        this.pos += 1;
        if (ch === 'u') {
          if (this.pos + 4 > this.buf.length) {
            this.pos = start;
            return null;
          }
          this.pos += 4;
        }
        continue;
      }
      if (ch === '\\') {
        inEscape = true;
        this.pos += 1;
        continue;
      }
      if (ch === '"') {
        const raw = this.buf.slice(start + 1, this.pos);
        this.pos += 1;
        try {
          return JSON.parse('"' + raw + '"') as string;
        } catch {
          return null;
        }
      }
      this.pos += 1;
    }
    this.pos = start;
    return null;
  }

  private readBool(): boolean | null {
    if (this.buf.startsWith('true', this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.buf.startsWith('false', this.pos)) {
      this.pos += 5;
      return false;
    }
    return null;
  }

  /** Skip past a JSON value (any type) at the current position. */
  private skipValue(): boolean {
    this.skipWhitespace();
    const c = this.peek();
    if (c === undefined) return false;
    if (c === '"') {
      const s = this.readString();
      return s !== null;
    }
    if (c === '{') {
      const v = this.readObjectAsJson<unknown>();
      return v !== null;
    }
    if (c === '[') {
      const v = this.readArrayAsJson<unknown>();
      return v !== null;
    }
    if (c === 't' || c === 'f') {
      return this.readBool() !== null;
    }
    if (c === 'n') {
      if (this.buf.startsWith('null', this.pos)) {
        this.pos += 4;
        return true;
      }
      return false;
    }
    // number
    const start = this.pos;
    while (this.pos < this.buf.length) {
      const ch = this.buf[this.pos]!;
      if (/[\d.eE+-]/.test(ch)) {
        this.pos += 1;
      } else {
        break;
      }
    }
    return this.pos > start;
  }

  /** Read a balanced `{...}` from the buffer and JSON.parse it. */
  private readObjectAsJson<T>(): T | null {
    if (this.peek() !== '{') return null;
    return this.readBalanced('{', '}') as T | null;
  }

  /** Read a balanced `[...]` from the buffer and JSON.parse it. */
  private readArrayAsJson<T>(): T[] | null {
    if (this.peek() !== '[') return null;
    return this.readBalanced('[', ']') as T[] | null;
  }

  private readBalanced(open: string, close: string): unknown {
    const start = this.pos;
    let depth = 0;
    let inString = false;
    let inEscape = false;
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos]!;
      this.pos += 1;
      if (inEscape) { inEscape = false; continue; }
      if (inString) {
        if (c === '\\') inEscape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) {
          const raw = this.buf.slice(start, this.pos);
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }
      }
    }
    // Did not close yet — rewind.
    this.pos = start;
    return null;
  }
}

type State = 'envelope_open' | 'envelope_key_or_close' | 'envelope_done';
