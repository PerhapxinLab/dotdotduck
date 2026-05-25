/**
 * Sitemap traversal + LLM-friendly serialization helpers.
 */

import type { SitemapNode, SitemapResolution } from './types';

/**
 * Render the sitemap as an indented outline an LLM can read efficiently.
 * Marks auth-gated pages, lists actions, shows dynamic segments as ":param".
 *
 * Example output:
 *   /                    Home — landing page
 *     /orders            Orders — list of orders
 *       actions: view, export, filter
 *       /:id             Order detail [auth]
 *         actions: refund, ship, cancel
 *       /new             New order [auth]
 *     /billing           Billing [auth]
 */
export function serializeSitemap(root: SitemapNode, options: { rootPath?: string } = {}): string {
  const lines: string[] = [];
  walk(root, options.rootPath ?? '/', 0, lines);
  return lines.join('\n');
}

function walk(node: SitemapNode, path: string, depth: number, out: string[]): void {
  if (node.hidden) return;

  const indent = '  '.repeat(depth);
  const flags: string[] = [];
  if (node.requiresAuth) flags.push('auth');
  if (node.requiresAdmin) flags.push('admin');
  const flagStr = flags.length ? ` [${flags.join(',')}]` : '';

  out.push(`${indent}${path.padEnd(30 - depth * 2)} ${node.title}${flagStr}${node.description ? ` — ${node.description}` : ''}`);

  if (node.actions && node.actions.length > 0) {
    out.push(`${indent}  actions: ${node.actions.join(', ')}`);
  }
  if (node.notes) {
    out.push(`${indent}  note: ${node.notes}`);
  }
  if (node.keywords && node.keywords.length > 0) {
    out.push(`${indent}  keywords: ${node.keywords.join(', ')}`);
  }

  if (node.children) {
    for (const [segment, child] of Object.entries(node.children)) {
      const childPath = path === '/' ? `/${segment}` : `${path}/${segment}`;
      walk(child, childPath, depth + 1, out);
    }
  }
}

/**
 * Resolve a concrete URL path against the sitemap.
 * Supports `:param` segments matching any value.
 */
export function resolvePath(root: SitemapNode, targetPath: string): SitemapResolution | null {
  const segments = targetPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  return resolveSegments(root, '/', segments, {});
}

function resolveSegments(
  node: SitemapNode,
  currentPath: string,
  remaining: string[],
  params: Record<string, string>
): SitemapResolution | null {
  if (remaining.length === 0) {
    return { path: currentPath, node, params };
  }
  if (!node.children) return null;

  const [head, ...tail] = remaining;
  if (!head) return null;

  // Try exact match first — but allow backtracking to param match if the
  // exact-match subtree doesn't resolve the remainder.
  const exact = node.children[head];
  if (exact) {
    const next = currentPath === '/' ? `/${head}` : `${currentPath}/${head}`;
    const exactResult = resolveSegments(exact, next, tail, params);
    if (exactResult) return exactResult;
  }

  // Try param matches — multiple param siblings are possible; try each.
  for (const [segment, child] of Object.entries(node.children)) {
    if (segment.startsWith(':')) {
      const paramName = segment.slice(1);
      const next = currentPath === '/' ? `/${head}` : `${currentPath}/${head}`;
      const result = resolveSegments(child, next, tail, { ...params, [paramName]: head });
      if (result) return result;
    }
  }

  return null;
}

/**
 * Find nodes whose `title`, `description`, or `keywords` fuzzy-match a query.
 * Returns sorted by path depth (shallower first).
 */
export function searchSitemap(
  root: SitemapNode,
  query: string
): SitemapResolution[] {
  const lower = query.toLowerCase();
  const matches: Array<SitemapResolution & { depth: number }> = [];

  function visit(node: SitemapNode, path: string, depth: number, params: Record<string, string>) {
    if (node.hidden) return;
    const haystack = [
      node.title,
      node.description ?? '',
      ...(node.keywords ?? []),
    ].join(' ').toLowerCase();
    if (haystack.includes(lower)) {
      matches.push({ path, node, params, depth });
    }
    if (node.children) {
      for (const [seg, child] of Object.entries(node.children)) {
        const childPath = path === '/' ? `/${seg}` : `${path}/${seg}`;
        visit(child, childPath, depth + 1, params);
      }
    }
  }

  visit(root, '/', 0, {});
  matches.sort((a, b) => a.depth - b.depth);
  return matches.map(({ depth, ...m }) => m);
}

/** List all auth-gated paths in the tree (so agent can warn/login first). */
export function listAuthGatedPaths(root: SitemapNode): string[] {
  const out: string[] = [];
  function visit(node: SitemapNode, path: string) {
    if (node.requiresAuth || node.requiresAdmin) out.push(path);
    if (node.children) {
      for (const [seg, child] of Object.entries(node.children)) {
        const next = path === '/' ? `/${seg}` : `${path}/${seg}`;
        visit(child, next);
      }
    }
  }
  visit(root, '/');
  return out;
}

/**
 * Template — a starter SaaS sitemap structure. Host copies + customizes.
 * Covers most common shape: marketing root, auth gate, dashboard, settings,
 * a resource list+detail+new pattern, billing.
 */
export const SAAS_SITEMAP_TEMPLATE: SitemapNode = {
  title: 'Home',
  description: 'Marketing / landing page',
  children: {
    'login': { title: 'Sign in', description: 'Login page' },
    'signup': { title: 'Sign up', description: 'Create an account' },
    'dashboard': {
      title: 'Dashboard',
      description: 'Main app entry after login',
      requiresAuth: true,
      actions: ['view'],
    },
    'orders': {
      title: 'Orders',
      description: 'List of orders',
      requiresAuth: true,
      actions: ['view', 'filter', 'export'],
      children: {
        'new': { title: 'New order', requiresAuth: true, actions: ['create'] },
        ':id': {
          title: 'Order detail',
          requiresAuth: true,
          actions: ['view', 'edit', 'cancel', 'refund', 'ship'],
        },
      },
    },
    'settings': {
      title: 'Settings',
      requiresAuth: true,
      children: {
        'profile': { title: 'Profile', requiresAuth: true, actions: ['edit'] },
        'team': { title: 'Team', requiresAuth: true, requiresAdmin: true },
        'billing': {
          title: 'Billing',
          requiresAuth: true,
          requiresAdmin: true,
          actions: ['view', 'upgrade', 'cancel'],
        },
        'api-keys': {
          title: 'API keys',
          requiresAuth: true,
          requiresAdmin: true,
          actions: ['view', 'create', 'revoke'],
        },
      },
    },
  },
};
