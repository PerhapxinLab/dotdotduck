/**
 * JSON Pointer (RFC 6901, simplified) helpers shared by both renderers.
 */

export function readPointer(data: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  if (!path.startsWith('/')) return data[path];
  const parts = path.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = data;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as object)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function applyPointer(
  data: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  if (!path) return data;
  if (!path.startsWith('/')) return { ...data, [path]: value };
  const parts = path.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  const last = parts.pop();
  const next: Record<string, unknown> = { ...data };
  if (!last) return next;
  let cur: Record<string, unknown> = next;
  for (const p of parts) {
    const existing = cur[p];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      const cloned = { ...(existing as Record<string, unknown>) };
      cur[p] = cloned;
      cur = cloned;
    } else {
      const fresh: Record<string, unknown> = {};
      cur[p] = fresh;
      cur = fresh;
    }
  }
  cur[last] = value;
  return next;
}
