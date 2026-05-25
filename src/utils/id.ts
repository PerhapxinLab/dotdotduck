/**
 * Small id generator.
 *
 * Not collision-proof (we're not crypto.randomUUID here — that pulls in
 * different polyfills for SSR), but the combination of a millisecond
 * timestamp + a 6-char base36 random suffix is enough for any in-memory
 * uniqueness need (palette attachments, mock tool calls, etc).
 */
export function genId(prefix?: string): string {
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return prefix ? `${prefix}_${suffix}` : suffix;
}
