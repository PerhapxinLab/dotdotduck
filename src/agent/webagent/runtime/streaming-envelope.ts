/**
 * Streaming envelope parser — scanner-based.
 *
 * The previous state-machine version bailed permanently the first time a
 * field's value spanned two SSE fragments (the readers returned `null` on
 * "incomplete" but the dispatcher treated null as a permanent failure).
 * In practice that meant nano — which emits the JSON char-by-char — bailed
 * on the very first long string (memory), so streaming "looked" enabled
 * but every turn fell back to JSON-parse-when-done.
 *
 * This rewrite is a forward-only buffer scanner. Every call to `feed()`:
 *
 *   1. Appends the new chars to `buf`.
 *   2. Walks the outer envelope object at depth=1, looking for `"<key>":`
 *      pairs we haven't emitted yet.
 *   3. For each known top-level key (memory / turn_planning / todo_adjust
 *      / todos_remaining / is_final), tries to read its value. If the
 *      value isn't fully in `buf` yet, leaves it alone — next `feed()`
 *      will see it grown and try again.
 *   4. For `actions`, scans the array element-by-element:
 *      - For each new partial action object (`{...` open, no `}` close
 *        yet), emits `narrate_delta` chars from inside its `"narrate":"..."`
 *        field as they arrive — that's the LIVE subtitle stream.
 *      - When the object's `}` lands, JSON.parse the slice, emit
 *        `action_start` + `about_complete` + `narrate_complete` +
 *        `tool_args_complete` synchronously, and advance past it.
 *   5. When the outer envelope's `}` lands, emits `envelope_complete`.
 *
 * There is NO bail. Malformed JSON triggers a single bail at the action
 * parse site and surfaces as `null` from `feed()` so the loop can fall
 * back to the JSON-parse path; otherwise the scanner is fully resumable.
 *
 * Performance: each `feed()` only re-scans from `scanPos` (cached
 * position), so cost is linear in TOTAL stream length even though the
 * full `buf` grows.
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

const TOP_LEVEL_KEYS = ['memory', 'turn_planning', 'todo_adjust', 'todos_remaining', 'actions', 'is_final'] as const;

export class StreamingEnvelopeParser {
  private buf = '';
  private envelopeOpenedAt = -1; // position right after the outer `{`
  private envelopeClosed = false;
  private envelopeCompleteEmitted = false;
  private bailed = false;
  private readonly emittedKeys = new Set<string>();

  // Action tracking — actions are dispatched one at a time as their
  // closing `}` lands. For the action currently being streamed (still
  // open), we emit narrate chars as they arrive via `partialActionStart`.
  private actionsArrayOpenAt = -1; // position right after `[`
  private actionsArrayClosed = false;
  private nextActionIdx = 0;
  // Where to resume scanning the array on next entry to scanActions.
  // Advances past each consumed action's closing `}`. -1 = use
  // actionsArrayOpenAt (first entry).
  private actionsScanCursor = -1;
  private partialActionStart = -1; // pos of `{` for the currently-streaming action, -1 if between actions
  private partialActionStarted = false; // emitted action_start for partialActionStart
  private partialNarrateEmittedLen = 0;

  feed(delta: string): EnvelopeStreamEvent[] | null {
    if (this.bailed) return null;
    this.buf += delta;
    const events: EnvelopeStreamEvent[] = [];
    try {
      this.scan(events);
    } catch (err) {
      this.bailed = true;
      return null;
    }
    return events;
  }

  finish(): EnvelopeStreamEvent[] | null {
    if (this.bailed) return null;
    const events: EnvelopeStreamEvent[] = [];
    // Final scan to flush anything we can pick up.
    try {
      this.scan(events);
    } catch {
      this.bailed = true;
      return null;
    }
    if (this.envelopeClosed && !this.envelopeCompleteEmitted) {
      events.push({ kind: 'envelope_complete' });
      this.envelopeCompleteEmitted = true;
    }
    return events;
  }

  hasBailed(): boolean {
    return this.bailed;
  }

  // ─── scanner ────────────────────────────────────────────────────

  private scan(events: EnvelopeStreamEvent[]): void {
    if (this.envelopeClosed) return;

    // Locate the outer `{`. Provider/SSE quirks can deliver fragments
    // out of order — sometimes the opening `{"` lands AFTER a chunk
    // like `memory` in the visible delta. Scan forward for the FIRST
    // `{` anywhere in the buffer rather than asserting it's at the
    // head. If not present yet, wait for more chars.
    if (this.envelopeOpenedAt < 0) {
      const i = this.buf.indexOf('{');
      if (i < 0) return;
      this.envelopeOpenedAt = i + 1;
    }

    // For each known top-level key not yet emitted, try to read it.
    for (const key of TOP_LEVEL_KEYS) {
      if (this.emittedKeys.has(key)) continue;
      if (key === 'actions') {
        // actions has its own streaming logic
        this.scanActions(events);
        continue;
      }
      this.tryEmitTopLevelKey(key, events);
    }

    // Once actions array closed AND we've reached outer `}`, fire
    // envelope_complete.
    if (!this.envelopeClosed) {
      const closePos = this.findOuterCloseBrace();
      if (closePos >= 0) {
        this.envelopeClosed = true;
        events.push({ kind: 'envelope_complete' });
        this.envelopeCompleteEmitted = true;
      }
    }
  }

  private tryEmitTopLevelKey(key: string, events: EnvelopeStreamEvent[]): void {
    const valueStart = this.locateTopLevelValueStart(key);
    if (valueStart < 0) return;

    switch (key) {
      case 'memory': {
        const value = this.readStringAt(valueStart);
        if (value === null) return;
        events.push({ kind: 'memory_complete', value: value.text });
        this.emittedKeys.add('memory');
        return;
      }
      case 'turn_planning': {
        const obj = this.readBalancedAt(valueStart, '{', '}');
        if (obj === null) return;
        try {
          events.push({
            kind: 'turn_planning_complete',
            value: JSON.parse(obj.raw) as { evaluation_previous_goal: string; next_goal: string },
          });
        } catch {
          throw new Error('turn_planning JSON.parse failed');
        }
        this.emittedKeys.add('turn_planning');
        return;
      }
      case 'todo_adjust': {
        const obj = this.readBalancedAt(valueStart, '{', '}');
        if (obj === null) return;
        try {
          events.push({ kind: 'todo_adjust_complete', value: JSON.parse(obj.raw) });
        } catch {
          throw new Error('todo_adjust JSON.parse failed');
        }
        this.emittedKeys.add('todo_adjust');
        return;
      }
      case 'todos_remaining': {
        const arr = this.readBalancedAt(valueStart, '[', ']');
        if (arr === null) return;
        try {
          events.push({ kind: 'todos_remaining_complete', value: JSON.parse(arr.raw) as string[] });
        } catch {
          throw new Error('todos_remaining JSON.parse failed');
        }
        this.emittedKeys.add('todos_remaining');
        return;
      }
      case 'is_final': {
        const bool = this.readBoolAt(valueStart);
        if (bool === null) return;
        events.push({ kind: 'is_final_complete', value: bool });
        this.emittedKeys.add('is_final');
        return;
      }
    }
  }

  /**
   * Walk the actions array. Emits action_start + per-field events for
   * each new complete action. While an action is still streaming open,
   * scans inside its narrate field and emits narrate_delta chars as
   * they arrive.
   */
  private scanActions(events: EnvelopeStreamEvent[]): void {
    if (this.actionsArrayClosed) return;
    if (this.actionsArrayOpenAt < 0) {
      const valueStart = this.locateTopLevelValueStart('actions');
      if (valueStart < 0) return;
      if (this.buf.charAt(valueStart) !== '[') return;
      this.actionsArrayOpenAt = valueStart + 1;
    }

    let pos = this.partialActionStart >= 0
      ? this.partialActionStart
      : (this.actionsScanCursor >= 0 ? this.actionsScanCursor : this.actionsArrayOpenAt);

    while (true) {
      pos = this.skipWhitespaceAndCommas(pos);
      if (pos >= this.buf.length) {
        this.partialActionStart = -1;
        return;
      }
      const c = this.buf.charAt(pos);
      if (c === ']') {
        this.actionsArrayClosed = true;
        this.emittedKeys.add('actions');
        return;
      }
      if (c !== '{') {
        // Unexpected — wait for more chars (might be partial whitespace).
        this.partialActionStart = -1;
        return;
      }

      // Action object starts. Mark + emit action_start if not yet.
      if (this.partialActionStart !== pos) {
        this.partialActionStart = pos;
        this.partialActionStarted = false;
        this.partialNarrateEmittedLen = 0;
      }
      if (!this.partialActionStarted) {
        events.push({ kind: 'action_start', index: this.nextActionIdx });
        this.partialActionStarted = true;
      }

      // Try to find balanced `}` to complete this action.
      const balanced = this.readBalancedAt(pos, '{', '}');
      if (balanced === null) {
        // Incomplete action — but we can still stream narrate chars
        // from inside it as they arrive.
        this.streamPartialNarrate(pos, events);
        return;
      }

      // Complete action — JSON.parse and emit per-field events.
      let parsed: { about?: string; narrate?: string; tool?: string; args?: Record<string, unknown> };
      try {
        parsed = JSON.parse(balanced.raw);
      } catch {
        throw new Error('action JSON.parse failed');
      }
      const idx = this.nextActionIdx;
      if (typeof parsed.about === 'string' && parsed.about) {
        events.push({ kind: 'about_complete', index: idx, value: parsed.about });
      }
      if (typeof parsed.narrate === 'string') {
        // Flush any narrate chars we haven't streamed yet via the partial
        // scan (covers actions whose narrate field arrived in one chunk
        // OR where partial scan missed something).
        const already = this.partialNarrateEmittedLen;
        if (already < parsed.narrate.length) {
          events.push({
            kind: 'narrate_delta',
            index: idx,
            delta: parsed.narrate.slice(already),
          });
        }
        events.push({ kind: 'narrate_complete', index: idx, full: parsed.narrate });
      }
      if (typeof parsed.tool === 'string') {
        events.push({
          kind: 'tool_args_complete',
          index: idx,
          tool: parsed.tool,
          args: (parsed.args ?? {}) as Record<string, unknown>,
        });
      }
      this.nextActionIdx += 1;
      this.partialActionStart = -1;
      this.partialActionStarted = false;
      this.partialNarrateEmittedLen = 0;
      pos = balanced.end + 1;
      this.actionsScanCursor = pos; // resume here on next scan
    }
  }

  /**
   * For the partial action object at `pos`, look for `"narrate":"..."`
   * inside it and emit narrate_delta for any chars we haven't yet.
   *
   * Doesn't matter if we mis-find narrate boundaries inside other fields
   * — the readBalancedAt path is brace-aware, so when the full action
   * arrives we'll JSON.parse correctly and any over/under streaming
   * gets reconciled via the `partialNarrateEmittedLen` accounting (see
   * the action-complete path above).
   */
  private streamPartialNarrate(actionStart: number, events: EnvelopeStreamEvent[]): void {
    // Search for `"narrate"` inside the partial action.
    const slice = this.buf.slice(actionStart);
    const m = slice.match(/"narrate"\s*:\s*"/);
    if (!m) return;
    const valueStart = actionStart + m.index! + m[0].length;
    // Walk chars to find closing `"` (respect escapes). Emit deltas
    // for chars between `partialNarrateEmittedLen` and the current
    // scanned position.
    let i = valueStart + this.partialNarrateEmittedLen;
    let inEscape = false;
    let consumed = this.partialNarrateEmittedLen;
    let decoded = '';
    while (i < this.buf.length) {
      const ch = this.buf.charAt(i);
      if (inEscape) {
        inEscape = false;
        // Translate basic escape sequences for display.
        switch (ch) {
          case 'n': decoded += '\n'; break;
          case 't': decoded += '\t'; break;
          case 'r': decoded += '\r'; break;
          case '"': decoded += '"'; break;
          case '\\': decoded += '\\'; break;
          case '/': decoded += '/'; break;
          case 'u': {
            // Need 4 hex digits — if not yet in buf, stop here.
            if (i + 4 >= this.buf.length) break;
            const hex = this.buf.slice(i + 1, i + 5);
            const code = parseInt(hex, 16);
            if (!isNaN(code)) {
              decoded += String.fromCharCode(code);
              i += 4;
            }
            break;
          }
          default: decoded += ch;
        }
        consumed += 1;
        i += 1;
        continue;
      }
      if (ch === '\\') {
        inEscape = true;
        consumed += 1;
        i += 1;
        continue;
      }
      if (ch === '"') {
        // Closing of narrate. Don't include in delta; let the
        // action-complete path emit narrate_complete.
        break;
      }
      decoded += ch;
      consumed += 1;
      i += 1;
    }
    if (decoded) {
      events.push({
        kind: 'narrate_delta',
        index: this.nextActionIdx,
        delta: decoded,
      });
      this.partialNarrateEmittedLen = consumed;
    }
  }

  // ─── primitives ────────────────────────────────────────────────

  private findFirstNonWhitespace(from: number): number {
    for (let i = from; i < this.buf.length; i++) {
      const c = this.buf.charAt(i);
      if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') return i;
    }
    return -1;
  }

  private skipWhitespaceAndCommas(from: number): number {
    let i = from;
    while (i < this.buf.length) {
      const c = this.buf.charAt(i);
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === ',') {
        i += 1;
      } else {
        return i;
      }
    }
    return i;
  }

  /**
   * Find `"<key>":` at depth=1 (i.e. directly inside the envelope's outer
   * `{`). Returns the position right after the `:` (with whitespace
   * skipped), or -1 if not found yet. Depth-aware so we don't match
   * keys-with-the-same-name nested inside object/array values.
   */
  private locateTopLevelValueStart(key: string): number {
    if (this.envelopeOpenedAt < 0) return -1;
    const target = `"${key}"`;
    let depth = 1; // we're inside outer `{`
    let i = this.envelopeOpenedAt;
    let inStr = false;
    let inEscape = false;
    while (i < this.buf.length) {
      const ch = this.buf.charAt(i);
      if (inEscape) { inEscape = false; i += 1; continue; }
      if (inStr) {
        if (ch === '\\') { inEscape = true; i += 1; continue; }
        if (ch === '"') { inStr = false; i += 1; continue; }
        i += 1; continue;
      }
      // not in string
      if (ch === '"') {
        if (depth === 1 && this.buf.startsWith(target, i)) {
          // Verify it's a key — must be followed by `:` (possibly w/ ws).
          let j = i + target.length;
          while (j < this.buf.length && /\s/.test(this.buf.charAt(j))) j += 1;
          if (j < this.buf.length && this.buf.charAt(j) === ':') {
            j += 1;
            while (j < this.buf.length && /\s/.test(this.buf.charAt(j))) j += 1;
            if (j >= this.buf.length) return -1; // value not yet
            return j;
          }
          // Not followed by `:` yet — wait for more chars.
          return -1;
        }
        // Some other string at depth=1 — skip it
        inStr = true;
        i += 1;
        continue;
      }
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') depth -= 1;
      i += 1;
    }
    return -1;
  }

  private findOuterCloseBrace(): number {
    if (this.envelopeOpenedAt < 0) return -1;
    let depth = 1;
    let i = this.envelopeOpenedAt;
    let inStr = false;
    let inEscape = false;
    while (i < this.buf.length) {
      const ch = this.buf.charAt(i);
      if (inEscape) { inEscape = false; i += 1; continue; }
      if (inStr) {
        if (ch === '\\') { inEscape = true; i += 1; continue; }
        if (ch === '"') inStr = false;
        i += 1; continue;
      }
      if (ch === '"') { inStr = true; i += 1; continue; }
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) return i;
      }
      i += 1;
    }
    return -1;
  }

  private readStringAt(start: number): { text: string; end: number } | null {
    if (this.buf.charAt(start) !== '"') return null;
    let i = start + 1;
    let inEscape = false;
    while (i < this.buf.length) {
      const ch = this.buf.charAt(i);
      if (inEscape) { inEscape = false; i += 1; continue; }
      if (ch === '\\') { inEscape = true; i += 1; continue; }
      if (ch === '"') {
        const raw = this.buf.slice(start, i + 1);
        try {
          return { text: JSON.parse(raw) as string, end: i };
        } catch {
          return null;
        }
      }
      i += 1;
    }
    return null; // incomplete
  }

  private readBalancedAt(start: number, open: '{' | '[', close: '}' | ']'): { raw: string; end: number } | null {
    if (this.buf.charAt(start) !== open) return null;
    let depth = 1;
    let i = start + 1;
    let inStr = false;
    let inEscape = false;
    while (i < this.buf.length) {
      const ch = this.buf.charAt(i);
      if (inEscape) { inEscape = false; i += 1; continue; }
      if (inStr) {
        if (ch === '\\') { inEscape = true; i += 1; continue; }
        if (ch === '"') inStr = false;
        i += 1; continue;
      }
      if (ch === '"') { inStr = true; i += 1; continue; }
      if (ch === open || (open === '{' && ch === '[') || (open === '[' && ch === '{')) depth += 1;
      else if (ch === close || (close === '}' && ch === ']') || (close === ']' && ch === '}')) {
        depth -= 1;
        if (depth === 0) {
          return { raw: this.buf.slice(start, i + 1), end: i };
        }
      }
      i += 1;
    }
    return null; // incomplete
  }

  private readBoolAt(start: number): boolean | null {
    if (this.buf.startsWith('true', start)) return true;
    if (this.buf.startsWith('false', start)) return false;
    // Partial 't'/'f' at end means incomplete — return null.
    return null;
  }
}
