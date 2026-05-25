/**
 * Runtime sitemap learning — extend a static sitemap with pages the agent
 * (or user) actually visits.
 *
 * Why: static sitemap covers known routes. But real apps have routes the
 * author forgot, or dynamic /:id pages with many instances. Learner observes
 * navigation events + DOM read summaries and augments the tree incrementally.
 *
 * Storage is host-supplied (any sync K/V — typically wrap dddk Cache).
 *
 * NOT enabled by default — host opts in:
 *   const learner = new SitemapLearner({ base: SAAS_SITEMAP_TEMPLATE, storage });
 *   learner.observePath(location.pathname, { title: document.title, ... });
 *   const augmented = learner.materialize();
 *   new WebAgent({ sitemap: augmented, ... });
 */

import type { SitemapNode } from './types';

export interface SitemapLearnerStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface SitemapLearnerOptions {
  /** Base static sitemap. Learned data merges on top. */
  base: SitemapNode;
  /** Persistent storage (use dddk Cache or any K/V). */
  storage: SitemapLearnerStorage;
  /** Storage key. Default 'webagent.sitemap.learned'. */
  storageKey?: string;
  /** Cap on learned children per parent — prevents unbounded tree growth. Default 50. */
  maxLearnedPerParent?: number;
  /** Treat segments matching this as dynamic (collapse to :param). Default UUIDs / numeric ids. */
  isDynamicSegment?: (segment: string) => boolean;
}

interface LearnedNode {
  title?: string;
  description?: string;
  actions?: string[];
  visitCount: number;
  lastVisited: number;
}

type LearnedTree = Record<string, LearnedNode>;  // path → learned info

const DEFAULT_DYNAMIC_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^\d+$/,                          // pure numeric id
  /^[A-Za-z0-9_-]{12,}$/,           // long opaque id
];

export class SitemapLearner {
  private opts: Required<Pick<SitemapLearnerOptions, 'storageKey' | 'maxLearnedPerParent' | 'isDynamicSegment'>> &
    SitemapLearnerOptions;
  private learned: LearnedTree;

  constructor(opts: SitemapLearnerOptions) {
    this.opts = {
      storageKey: 'webagent.sitemap.learned',
      maxLearnedPerParent: 50,
      isDynamicSegment: (seg) => DEFAULT_DYNAMIC_PATTERNS.some((p) => p.test(seg)),
      ...opts,
    };
    this.learned = this.read();
  }

  /**
   * Record a page visit. Path is normalized (dynamic segments → :param).
   * Optional `info` gets merged into the learned node (title / actions etc.).
   */
  observePath(
    path: string,
    info: { title?: string; description?: string; actions?: string[] } = {}
  ): void {
    const norm = this.normalizePath(path);
    const cur = this.learned[norm] ?? { visitCount: 0, lastVisited: 0 };
    cur.visitCount += 1;
    cur.lastVisited = Date.now();
    if (info.title) cur.title = info.title;
    if (info.description) cur.description = info.description;
    if (info.actions) cur.actions = Array.from(new Set([...(cur.actions ?? []), ...info.actions]));
    this.learned[norm] = cur;
    this.write();
  }

  /**
   * Produce an augmented sitemap merging base + learned data.
   * Learned nodes that already exist in base just merge metadata.
   * Learned nodes that DON'T exist in base get added as new children.
   */
  materialize(): SitemapNode {
    const cloned = structuredClone(this.opts.base);
    for (const [path, info] of Object.entries(this.learned)) {
      this.mergePath(cloned, path, info);
    }
    return cloned;
  }

  /** Drop all learned data — keep static base. */
  reset(): void {
    this.learned = {};
    this.write();
  }

  /** Read raw learned tree (for inspection / export). */
  inspect(): LearnedTree {
    return { ...this.learned };
  }

  // ─── private ──────────────────────────────────────────────────────

  private normalizePath(path: string): string {
    const segments = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    return '/' + segments.map((s) => (this.opts.isDynamicSegment(s) ? ':id' : s)).join('/');
  }

  private mergePath(root: SitemapNode, path: string, info: LearnedNode): void {
    const segments = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    let cur = root;
    for (const seg of segments) {
      cur.children = cur.children ?? {};
      let next = cur.children[seg];
      if (!next) {
        const count = Object.keys(cur.children).length;
        if (count >= this.opts.maxLearnedPerParent) return; // cap
        next = {
          title: seg.startsWith(':') ? `${seg.slice(1)} detail` : seg,
        };
        cur.children[seg] = next;
      }
      cur = next;
    }
    // Merge metadata into leaf
    if (info.title && !cur.title) cur.title = info.title;
    if (info.description && !cur.description) cur.description = info.description;
    if (info.actions) {
      cur.actions = Array.from(new Set([...(cur.actions ?? []), ...info.actions]));
    }
  }

  private read(): LearnedTree {
    const raw = this.opts.storage.get(this.opts.storageKey);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as LearnedTree;
    } catch {
      return {};
    }
  }

  private write(): void {
    this.opts.storage.set(this.opts.storageKey, JSON.stringify(this.learned));
  }
}
