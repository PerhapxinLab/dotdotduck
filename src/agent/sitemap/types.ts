/**
 * Sitemap — tree/graph structure for agent navigation on multi-page sites.
 *
 * Why a tree?
 *   Flat sitemap[] doesn't scale past ~10 pages. Agent has to scan everything
 *   to figure out what's reachable. Tree gives:
 *     - hierarchy (parent → children) → agent can drill down step-by-step
 *     - per-node metadata (auth requirements, available actions, sub-routes)
 *     - LLM-friendly serialization (indented outline matches how LLMs reason)
 *
 * Static-only in v1. Host writes it in config. Runtime learning deferred to v2.
 */

export interface SitemapNode {
  /**
   * Display title for the page. Goes into prompts and palette search results.
   */
  title: string;

  /**
   * One-line description. Agent uses this to match "I want to do X" intent
   * against the right page.
   */
  description?: string;

  /**
   * Child routes. Key is the path segment (relative to this node).
   * Use `:id` / `:slug` for dynamic segments — agent knows it's a parameter.
   */
  children?: Record<string, SitemapNode>;

  /**
   * Verbs the user can perform on this page. Agent uses these to plan.
   * Examples: ['view', 'edit', 'export', 'delete', 'refund', 'ship']
   */
  actions?: string[];

  /**
   * If true, agent must ensure user is logged in (likely navigate to /login
   * first) before visiting. The login flow itself uses DOM operations (click
   * the login button, fill the form) — dddk does NOT handle OAuth.
   */
  requiresAuth?: boolean;

  /**
   * If true, requires elevated permission. Agent should explain this to user
   * before attempting.
   */
  requiresAdmin?: boolean;

  /**
   * Hidden from the LLM prompt (still navigable, just not advertised). Useful
   * for internal-only routes.
   */
  hidden?: boolean;

  /**
   * Free-form notes the host wants the agent to remember about this page.
   * e.g., "Pagination is server-driven — use the [Next] button, not URL ?page=N"
   */
  notes?: string;

  /**
   * Optional keywords the agent should match user intent against. Saves a
   * prompt token vs putting everything in description.
   */
  keywords?: string[];
}

export interface SitemapResolution {
  /** Concrete URL path with parameters substituted. */
  path: string;
  /** The matched node. */
  node: SitemapNode;
  /** Parameters extracted from / supplied for the path. */
  params: Record<string, string>;
}
