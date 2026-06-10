/** Default PII patterns blocked from writing into memory. Hosts can extend
 *  via `MemoryPrivacyConfig.excludePatterns`. */

export const DEFAULT_PII_PATTERNS: RegExp[] = [
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
  /\bpassword\s*[:=]/i,
  /\bpasswd\s*[:=]/i,
  /\bsecret\s*[:=]/i,
  /\bsk-[a-zA-Z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
];

export function looksLikePII(text: string, extra: RegExp[] = []): boolean {
  for (const re of DEFAULT_PII_PATTERNS) if (re.test(text)) return true;
  for (const re of extra) if (re.test(text)) return true;
  return false;
}
