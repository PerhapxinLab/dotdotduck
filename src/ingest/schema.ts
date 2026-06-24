/**
 * Unified ingest event schema — v0.2.0 ROADMAP item 7.1.
 *
 * Every event flowing through the SDK conforms to this shape: intent
 * events (existing `IntentEvent` union), raw browser telemetry (clicks,
 * scrolls, hovers, focus — 7.2), and host-defined custom events via
 * `dddk.track(...)` (7.3). Downstream sinks (7.5) consume from one
 * canonical stream.
 *
 * Schema versioning rules:
 *
 *   - `schemaVersion` is bumped on every breaking change.
 *   - Within a minor SDK version, schema changes are ADDITIVE only —
 *     new optional fields, new event kinds. Existing consumers keep
 *     working without code changes.
 *   - Removing or renaming a field bumps the schema major.
 *   - The string in `EVENT_SCHEMA_VERSION` is the canonical version
 *     identifier; downstream pipelines should pin to a specific
 *     version and migrate explicitly.
 */

export const EVENT_SCHEMA_VERSION = '1.0.0';

/**
 * Top-level event categories. Each category has retention + routing
 * behavior. Downstream sinks can route per category.
 */
export type EventCategory =
  | 'intent'      // typed high-level events (palette, voice, agent, etc.)
  | 'interaction' // raw browser telemetry (clicks, scrolls, hovers, focus)
  | 'lifecycle'   // session/page/visitor lifecycle events
  | 'audit'       // audit-category events (10.x) — stronger durability
  | 'experiment'  // A/B variant exposure + outcomes
  | 'custom';     // host-defined via `dddk.track(...)`

export interface BaseEvent {
  /** Stable id assigned at emit time. */
  id: string;
  /** Schema version this event was emitted against. */
  schemaVersion: string;
  /** Category routes downstream sink behavior. */
  category: EventCategory;
  /** Type discriminator within the category. */
  kind: string;
  /** Unix epoch ms at emit time on the client. */
  timestamp: number;
  /** Multi-tenant scope, omitted in single-tenant / extension modes. */
  orgId?: string;
  visitorId?: string;
  sessionId?: string;
  /** Per-agent-run linkage, when applicable. */
  runId?: string;
  /** Page context at emit time. */
  page?: {
    path: string;
    locale?: string;
    title?: string;
  };
  /** Browser / device snapshot — populated by the SDK once per session. */
  device?: {
    ua?: string;
    deviceType?: 'desktop' | 'mobile' | 'tablet' | 'tv' | 'other';
    locale?: string;
  };
  /** Category-specific shape lives in `props`. */
  props?: Record<string, unknown>;
}

// ─── interaction props (7.2 raw telemetry) ────────────────────────────

export interface ClickEventProps {
  selector?: string;
  /** Stable hash id from the DOM dump if available, otherwise undefined. */
  domId?: string;
  tag?: string;
  text?: string;
  elementRole?: string;
  href?: string;
  buttonName?: string;
  modifierKeys?: string[];
}

export interface ScrollEventProps {
  /** 0-1 depth ratio of the page that's been scrolled past. */
  maxDepth: number;
  /** Direction sample over the last window. */
  direction?: 'up' | 'down';
  /** Optional per-element scroll if attached to a scrollable region. */
  containerSelector?: string;
}

export interface HoverEventProps {
  selector?: string;
  domId?: string;
  tag?: string;
  /** How long the mouse hovered before firing the event (ms). */
  dwellMs: number;
}

export interface FocusEventProps {
  selector?: string;
  domId?: string;
  fieldType?: string;
  fieldName?: string;
  /** Time-on-field (ms) — populated on blur events. */
  durationMs?: number;
  validity?: 'valid' | 'invalid' | 'pending';
}

export interface RoutingEventProps {
  from: string;
  to: string;
  trigger?: 'link' | 'spa' | 'back' | 'forward' | 'reload' | 'agent';
}

export interface PerformanceEventProps {
  /** Largest Contentful Paint (ms). */
  lcp?: number;
  /** Interaction to Next Paint (ms). */
  inp?: number;
  /** Cumulative Layout Shift. */
  cls?: number;
  /** Time to First Byte (ms). */
  ttfb?: number;
}

// ─── lifecycle ─────────────────────────────────────────────────────────

export interface SessionStartProps {
  /** True if `visitorId` was just created (first-ever visit). */
  newVisitor: boolean;
  referrer?: string;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
}

export interface PageViewProps {
  path: string;
  /** Previous path on SPA nav, undefined on first page view. */
  prevPath?: string;
}

// ─── custom ────────────────────────────────────────────────────────────

export type CustomEventProps = Record<string, unknown>;

// ─── helpers ───────────────────────────────────────────────────────────

/**
 * Construct a well-formed event with the current schema version + a
 * fresh id. Callers may override any field by spreading.
 */
export function makeEvent<P extends Record<string, unknown> = Record<string, unknown>>(
  category: EventCategory,
  kind: string,
  partial: Partial<Omit<BaseEvent, 'category' | 'kind' | 'schemaVersion'>> & { props?: P } = {},
): BaseEvent {
  return {
    id: partial.id ?? newEventId(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    category,
    kind,
    timestamp: partial.timestamp ?? Date.now(),
    orgId: partial.orgId,
    visitorId: partial.visitorId,
    sessionId: partial.sessionId,
    runId: partial.runId,
    page: partial.page,
    device: partial.device,
    props: partial.props,
  };
}

function newEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
