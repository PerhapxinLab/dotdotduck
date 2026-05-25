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

OUTPUT FORMAT — strictly JSON, no markdown, no prose:
{ "replacement": "<the new fragment text>" }

The "replacement" string replaces ONLY the text between [[SEL]] and [[/SEL]]. Keep punctuation and whitespace clean.`;

/** Extract the `replacement` string from the model's JSON response.
 *  Falls back to "best-effort cleanup of raw text" if JSON parsing fails. */
export function extractReplacement(raw: string): string {
  const trimmed = stripCodeFence(raw);
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj.replacement === 'string') return obj.replacement;
  } catch { /* fall through */ }
  // Fallback: try a regex extraction of the replacement field.
  const m = /"replacement"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(trimmed);
  if (m) {
    try {
      // Use JSON.parse on the captured string to decode escape sequences.
      return JSON.parse(`"${m[1]}"`);
    } catch { /* … */ }
  }
  // Last resort: strip common preamble and use the raw text.
  const out = trimmed.replace(/^(here'?s|here is|sure[,!]?|certainly[,!]?)\b[^\n]*\n+/i, '');
  return out.trim();
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
