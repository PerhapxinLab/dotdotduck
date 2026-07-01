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

Output format — wrap the new fragment text inside a single <replacement>…</replacement> XML tag. Nothing outside the tag: no prose, no JSON, no code fences.

<replacement>the new fragment text</replacement>

The text inside the tag replaces the original fragment between [[SEL]] and [[/SEL]]. Keep punctuation and whitespace clean. Stream-friendly: the runtime begins inserting your text into the user's input the moment the opening <replacement> tag closes, character by character; don't put leading newlines inside the tag unless they belong in the replacement.`;

export const REPLACEMENT_START = '<replacement>';
export const REPLACEMENT_END = '</replacement>';

/**
 * End-marker variants the streaming parser accepts. The canonical form
 * is `</replacement>` — a plain XML close tag that every model handles
 * reliably because it matches HTML/XML training data. The extras below
 * are legacy from the previous `<<<END>>>` prompt: kept so proxies
 * with cached responses still parse, but new prompts drive the XML
 * form and won't emit them.
 */
export const REPLACEMENT_END_VARIANTS: readonly string[] = [
  '</replacement>',
  '<< /replacement >>',       // rare stylistic variant
  // Legacy end markers from the old `<<<END>>>` prompt format. Kept
  // for back-compat while cached responses cycle out.
  '<<<END>>>',
  '<<</REPLACEMENT>>>',
  '[[/REPLACEMENT>>>',
  '[[/REPLACEMENT/>>>',
  '[[/REPLACEMENT]]',
  '<<<REPLACEMENT/>>>',
  '<<<END_REPLACEMENT>>>',
  '<<</END>>>',
  '[[/SEL]]',
];

/**
 * Catch-all pattern for any marker shape the enumerated list missed.
 * Handles both the canonical XML close (`</replacement>`) and any
 * legacy bracket-word-bracket hybrid a cached-response proxy might
 * still return. Any combination of `<`/`<<<`/`[[` opener + optional
 * slashes + `replacement`/`end`/`sel` word (case-insensitive) +
 * optional slashes + `>`/`>>>`/`]]` closer counts as an end marker.
 */
const END_MARKER_FALLBACK_RE = /(?:<{1,3}|\[\[)\s*\/?\s*(?:replacement|end|sel)\s*\/?\s*(?:>{1,3}|\]\])/i;

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
  // Regex fallback — only kicks in if none of the enumerated variants
  // matched. Guarantees any bracket-word-bracket combo terminates the
  // stream instead of leaking.
  if (best === null) {
    const m = END_MARKER_FALLBACK_RE.exec(text);
    if (m) best = { idx: m.index, len: m[0].length };
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
  // Regex fallback — sweeps any leftover bracket-word-bracket combos
  // the enumerated list missed.
  out = out.replace(new RegExp(END_MARKER_FALLBACK_RE.source, 'g'), '');
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
