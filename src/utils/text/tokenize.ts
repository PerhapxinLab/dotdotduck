/**
 * Universal tokeniser — Unicode-aware, no language packs, no per-locale forks.
 *
 * Why universal-only:
 *   The package ships globally. Hardcoding `en` / `zh-TW` stopword lists or
 *   Porter-stemming locks the toolbox to two languages and silently breaks
 *   for everyone else. Instead we split on Unicode script class:
 *     - whitespace scripts (Latin, Cyrillic, Arabic, Hebrew, Indic, Greek, …)
 *       → split on whitespace + punctuation
 *     - no-space scripts (CJK, Thai, Lao, Khmer, Burmese, …)
 *       → emit each letter / number codepoint
 *   Then NFKC-normalise + lowercase + bigram for both paths.
 *
 *   Hosts that have a domain-specific tokeniser (e.g. medical term splitter)
 *   pass their own `tokenize(text)` function to the toolbox module — see
 *   `createSearch({ tokenize })`. The default fits 200+ languages reasonably.
 */

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;
const SE_ASIAN_RE = /[฀-๿຀-໿ក-៿က-႟]/; // Thai / Lao / Khmer / Burmese
const LETTER_NUM_RE = /[\p{L}\p{N}]/u;

export function nfkc(s: string): string {
  return s.normalize('NFKC');
}

function isNoSpaceScript(text: string): boolean {
  const sample = text.slice(0, 200);
  return CJK_RE.test(sample) || SE_ASIAN_RE.test(sample);
}

function tokenizeNoSpace(text: string): string[] {
  const out: string[] = [];
  for (const c of nfkc(text)) {
    if (LETTER_NUM_RE.test(c)) out.push(c.toLowerCase());
  }
  return out;
}

function tokenizeWhitespace(text: string): string[] {
  return nfkc(text)
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter((t) => t.length > 0);
}

/** Plain token list. Default for QA / memory full-text matching. */
export function tokenize(text: string): string[] {
  return isNoSpaceScript(text) ? tokenizeNoSpace(text) : tokenizeWhitespace(text);
}

/**
 * Token list + bigrams — slightly broader recall than `tokenize`. Default
 * feature set for search / recommend scoring. Whitespace-script bigrams join
 * with `_`; CJK bigrams join with empty string (faithful to written form).
 */
export function extractFeatures(text: string): string[] {
  const noSpace = isNoSpaceScript(text);
  const tokens = noSpace ? tokenizeNoSpace(text) : tokenizeWhitespace(text);
  const bigrams: string[] = [];
  const sep = noSpace ? '' : '_';
  for (let i = 0; i + 1 < tokens.length; i++) {
    bigrams.push(tokens[i] + sep + tokens[i + 1]);
  }
  return [...tokens, ...bigrams];
}
