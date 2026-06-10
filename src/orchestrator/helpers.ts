/**
 * Pure-function helpers used by the orchestrator. Zero dependencies on
 * `DotDotDuck` state — safe to call from anywhere.
 */

import type { StorageAdapter } from '../types';

/** Read a Blob into a base64 data URL for `selection.images[]`. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function defaultStorage(): StorageAdapter {
  return {
    get: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(`dddk.${k}`) : null),
    set: (k, v) => {
      if (typeof localStorage !== 'undefined') localStorage.setItem(`dddk.${k}`, v);
    },
    remove: (k) => {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(`dddk.${k}`);
    },
  };
}

/**
 * Walk the current page's visible DOM text and return up to 20 hits whose
 * trimmed text content contains `q` (case-insensitive). Exported so hosts
 * can wire it into a `#`-prefix browse() — typing `#<query>` searches the
 * page in front of the user, distinct from `docs:` (full-text search across
 * the docs corpus).
 */
export function searchPageText(q: string): Array<{ text: string; element: HTMLElement }> {
  if (typeof document === 'undefined' || !q.trim()) return [];
  const out: Array<{ text: string; element: HTMLElement }> = [];
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? '').trim();
    if (text.toLowerCase().includes(needle)) {
      const el = node.parentElement;
      if (el && el.offsetParent !== null) {
        out.push({ text: text.slice(0, 80), element: el });
        if (out.length >= 20) break;
      }
    }
  }
  return out;
}
