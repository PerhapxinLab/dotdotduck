/**
 * Helpers for parsing LLM output.
 *
 * Models love to wrap structured replies in ```json ... ``` fences even when
 * the system prompt explicitly forbids it. Rather than scatter a slightly-
 * different regex through every module, we centralize here.
 */

/**
 * Strip leading/trailing markdown code fences (with optional language tag) and
 * whitespace. Leaves the inner content untouched.
 *
 * Examples:
 *   "```json\n{\"a\":1}\n```"  -> '{"a":1}'
 *   "```\n{}\n```"               -> '{}'
 *   "{\"a\":1}"                  -> '{"a":1}'
 */
export function stripCodeFence(s: string): string {
  return s
    .replace(/^\s*```(?:[a-zA-Z0-9_-]+)?\s*\n?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/**
 * Parse JSON, returning `null` on failure instead of throwing. Optionally
 * strips code fences first — convenient when feeding raw LLM completions.
 */
export function safeJsonParse<T = unknown>(s: string, { stripFence = true } = {}): T | null {
  try {
    return JSON.parse(stripFence ? stripCodeFence(s) : s) as T;
  } catch {
    return null;
  }
}
