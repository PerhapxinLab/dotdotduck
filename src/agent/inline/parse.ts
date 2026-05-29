/**
 * LLM-output parsing helpers for InlineAgent.
 * The system prompt is also here — keeping prompt + parser in one place makes
 * it easier to update them together when tuning the contract.
 */

import { stripCodeFence } from '../../utils/llm-parse';

/**
 * System prompt — strict edit-file style. The model gets the FULL surrounding
 * text (so it understands the context) and the marked fragment, but its
 * job is only to write the replacement for the fragment. We apply via
 * splice at the known character offsets — no fuzzy matching, no leakage.
 */
export const SYSTEM_PROMPT = `You are an inline editing assistant. The user highlighted a fragment INSIDE a longer text and gave an instruction. You see the full text (for context) and the fragment (delimited by [[SEL]] / [[/SEL]] markers).

Your ONLY job is to compute the new text that should replace the fragment between the markers. You DO NOT need to think out loud, plan, or analyse — the model is being used as a fast text-edit operator, not a reasoning agent.

Language rule: detect the language of the surrounding text and write the replacement in the SAME language, unless the instruction explicitly requests another language (e.g. "translate to Japanese"). This applies to any human language — English, Traditional Chinese, Japanese, Spanish, Arabic, etc.

OUTPUT FORMAT — emit ONLY the replacement text, wrapped in these exact markers, with no surrounding prose, JSON, code fences, or commentary:

<<<REPLACEMENT>>>
<the new fragment text>
<<<END>>>

The closing marker is literally <<<END>>> (three angle-brackets, the word END, three angle-brackets). DO NOT emit any of these instead: <<</REPLACEMENT>>>, [[/REPLACEMENT]], [[/REPLACEMENT>>>, <<<REPLACEMENT/>>>, or any other variant. The brackets you used for [[SEL]] are NOT the brackets used here — these markers use <<<...>>> only.

The text between the markers replaces ONLY the original fragment between [[SEL]] and [[/SEL]]. Keep punctuation and whitespace clean. Stream-friendly: the runtime starts inserting your text into the user's input the moment <<<REPLACEMENT>>> closes, character by character. Don't put leading newlines after <<<REPLACEMENT>>> unless they belong in the replacement.`;

export const REPLACEMENT_START = '<<<REPLACEMENT>>>';
export const REPLACEMENT_END = '<<<END>>>';

/**
 * End-marker variants the streaming parser will accept. The canonical
 * form is `<<<END>>>`, but small / fast models confuse the SEL marker
 * style (`[[/SEL]]`) with the REPLACEMENT marker style and emit hybrids
 * like `[[/REPLACEMENT>>>` or `<<</REPLACEMENT>>>`. Treating any of these
 * as "end of replacement" keeps the leak out of the user's input.
 *
 * Order matters only for tie-breaking when two variants overlap — we
 * pick the earliest occurrence (lowest indexOf), so collisions are rare.
 */
export const REPLACEMENT_END_VARIANTS: readonly string[] = [
  '<<<END>>>',
  '<<</REPLACEMENT>>>',
  '[[/REPLACEMENT>>>',
  '[[/REPLACEMENT]]',
  '<<<REPLACEMENT/>>>',
  '<<<END_REPLACEMENT>>>',
  '<<</END>>>',
  // Small models occasionally echo the SEL closing marker from the input
  // contract instead of the REPLACEMENT closing marker. Treat as end so
  // it never reaches the user's editable.
  '[[/SEL]]',
];

/** Scan `text` for the earliest end-marker variant. Returns the match
 *  position and the matched marker's length, or null if none. */
export function findEndMarker(text: string): { idx: number; len: number } | null {
  let best: { idx: number; len: number } | null = null;
  for (const m of REPLACEMENT_END_VARIANTS) {
    const idx = text.indexOf(m);
    if (idx >= 0 && (best === null || idx < best.idx)) {
      best = { idx, len: m.length };
    }
  }
  return best;
}

/**
 * Extract the replacement payload from the model's marker-wrapped
 * response. Resilient to:
 *   - extra whitespace / newlines around the markers
 *   - markers missing entirely (model ignored format → use raw text)
 *   - legacy JSON format from earlier prompts (parse and extract)
 *   - code-fenced output from a chatty model
 */
export function extractReplacement(raw: string): string {
  const trimmed = stripCodeFence(raw);
  const startIdx = trimmed.indexOf(REPLACEMENT_START);
  if (startIdx >= 0) {
    const after = trimmed.slice(startIdx + REPLACEMENT_START.length);
    const end = findEndMarker(after);
    const body = end !== null ? after.slice(0, end.idx) : after;
    return trimMarkerEdges(body);
  }
  // Legacy JSON fallback (in case any caller still sends old SYSTEM_PROMPT).
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj.replacement === 'string') return obj.replacement;
  } catch { /* fall through */ }
  const m = /"replacement"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(trimmed);
  if (m) {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch { /* … */ }
  }
  const out = trimmed.replace(/^(here'?s|here is|sure[,!]?|certainly[,!]?)\b[^\n]*\n+/i, '');
  // Belt for the no-start-marker fallback path: if the model echoed any of
  // the SEL input markers (or REPLACEMENT_END variant) without ever opening
  // <<<REPLACEMENT>>>, strip them so they don't leak into the editable.
  return stripStrayMarkers(out).trim();
}

function stripStrayMarkers(s: string): string {
  let out = s.replace(/\[\[\/?SEL\]\]/g, '');
  for (const m of REPLACEMENT_END_VARIANTS) {
    out = out.split(m).join('');
  }
  out = out.split(REPLACEMENT_START).join('');
  return out;
}

/** Strip the single leading + trailing newline the marker format
 *  encourages (each marker on its own line) without nuking meaningful
 *  whitespace inside the body. */
function trimMarkerEdges(s: string): string {
  let out = s;
  if (out.startsWith('\r\n')) out = out.slice(2);
  else if (out.startsWith('\n')) out = out.slice(1);
  if (out.endsWith('\r\n')) out = out.slice(0, -2);
  else if (out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

/** Slice a "context window" around the selection — up to ~CONTEXT_CHARS
 *  before and after — so the LLM understands the surrounding meaning
 *  without us shipping multi-megabyte textareas. */
const CONTEXT_CHARS = 400;

export function buildContextPrompt(fullText: string, selStart: number, selEnd: number): string {
  const ctxStart = Math.max(0, selStart - CONTEXT_CHARS);
  const ctxEnd = Math.min(fullText.length, selEnd + CONTEXT_CHARS);
  const head = fullText.slice(ctxStart, selStart);
  const sel = fullText.slice(selStart, selEnd);
  const tail = fullText.slice(selEnd, ctxEnd);
  const truncatedBefore = ctxStart > 0 ? '…' : '';
  const truncatedAfter = ctxEnd < fullText.length ? '…' : '';
  return `${truncatedBefore}${head}[[SEL]]${sel}[[/SEL]]${tail}${truncatedAfter}`;
}
