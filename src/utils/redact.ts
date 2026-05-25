/**
 * Strip secrets (typically API keys) from a string before logging or
 * raising it as an Error message. Empty/null secrets are skipped — they
 * would otherwise replace the entire string with `[REDACTED]`.
 */
export function redactSecrets(s: string, secrets: Array<string | undefined | null>): string {
  let out = s;
  for (const sec of secrets) {
    if (sec && sec.length > 0) {
      out = out.split(sec).join('[REDACTED]');
    }
  }
  return out;
}
