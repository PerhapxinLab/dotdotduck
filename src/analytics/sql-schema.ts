/**
 * Canonical SQL schema for `dddk_events`.
 *
 * Every event the SDK emits (intent / interaction / lifecycle / audit /
 * experiment / custom — see `src/ingest/schema.ts`) maps to exactly one
 * row of this shape. Hosts who want to land events in their own SQL
 * store get a stable, versioned target to write a migration against.
 * Hosts who don't have a SQL store at all use the bundled
 * `EventStore` (IndexedDB) and reuse this row shape for export.
 *
 * Schema versioning rules mirror `EVENT_SCHEMA_VERSION` in
 * `src/ingest/schema.ts` — additive within a minor, bump on rename /
 * remove. The DDL strings here will track that.
 *
 * Three dialects ship out of the box: SQLite, Postgres, MySQL. Hosts
 * on other engines (BigQuery, Snowflake, ClickHouse, DuckDB, …) can
 * map the column list manually; the type annotations below give the
 * source of truth.
 *
 * Column choices:
 *   - `id` is the canonical primary key. UUID-like string, 36 chars
 *     in the default emit path, but the column allows any TEXT so
 *     custom emitters can use shorter ids.
 *   - `props_json` is a TEXT-encoded JSON blob. We don't shred props
 *     into per-kind tables — that explodes schema-migration cost. For
 *     queries Postgres / MySQL / SQLite all have native JSON access
 *     (`->>`, `->`, `json_extract`); BigQuery / ClickHouse have their
 *     own JSON types. Keeping `props_json` as TEXT is the least
 *     surprising default that works everywhere.
 *   - `timestamp` is INTEGER ms-since-epoch. Native datetime types
 *     differ wildly per engine; ms-epoch round-trips cleanly into
 *     every one of them.
 *
 * Indexes shipped:
 *   - timestamp (range scans, ring-buffer eviction)
 *   - (category, kind) (typed event queries)
 *   - session_id (per-session funnels)
 *
 * Hosts running heavy BI workloads will want to add more indexes
 * (visitor_id, run_id, page_path). The DDL below is the minimum
 * sensible default — extend in your own migration.
 */

import type { BaseEvent } from '../ingest/schema';

/**
 * Flat row shape — one row per event. Optional event fields land as
 * `null` so the SQL schema can declare them NULLable. `props_json`
 * is the JSON-stringified props object (always present, empty
 * object string `'{}'` if the event has no props).
 */
export interface DddkEventRow {
  id: string;
  schema_version: string;
  category: string;
  kind: string;
  timestamp: number;
  org_id: string | null;
  visitor_id: string | null;
  session_id: string | null;
  run_id: string | null;
  page_path: string | null;
  page_locale: string | null;
  page_title: string | null;
  device_ua: string | null;
  device_type: string | null;
  device_locale: string | null;
  props_json: string;
}

/** Column list in the order the DDL declares — useful for INSERTs. */
export const DDDK_EVENTS_COLUMNS: ReadonlyArray<keyof DddkEventRow> = [
  'id',
  'schema_version',
  'category',
  'kind',
  'timestamp',
  'org_id',
  'visitor_id',
  'session_id',
  'run_id',
  'page_path',
  'page_locale',
  'page_title',
  'device_ua',
  'device_type',
  'device_locale',
  'props_json',
];

/** SQLite DDL. Drop-in `sqlite3 mydb.sqlite < ddl.sql`. */
export const DDDK_EVENTS_DDL_SQLITE = `\
CREATE TABLE IF NOT EXISTS dddk_events (
  id              TEXT PRIMARY KEY,
  schema_version  TEXT NOT NULL,
  category        TEXT NOT NULL,
  kind            TEXT NOT NULL,
  timestamp       INTEGER NOT NULL,
  org_id          TEXT,
  visitor_id      TEXT,
  session_id      TEXT,
  run_id          TEXT,
  page_path       TEXT,
  page_locale     TEXT,
  page_title      TEXT,
  device_ua       TEXT,
  device_type     TEXT,
  device_locale   TEXT,
  props_json      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dddk_events_timestamp      ON dddk_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_dddk_events_category_kind  ON dddk_events(category, kind);
CREATE INDEX IF NOT EXISTS idx_dddk_events_session        ON dddk_events(session_id);
`;

/** Postgres DDL. `BIGINT` timestamp; `JSONB` if you'd rather move props
 *  out of TEXT — the row mapper still emits stringified JSON either way. */
export const DDDK_EVENTS_DDL_POSTGRES = `\
CREATE TABLE IF NOT EXISTS dddk_events (
  id              TEXT PRIMARY KEY,
  schema_version  TEXT NOT NULL,
  category        TEXT NOT NULL,
  kind            TEXT NOT NULL,
  timestamp       BIGINT NOT NULL,
  org_id          TEXT,
  visitor_id      TEXT,
  session_id      TEXT,
  run_id          TEXT,
  page_path       TEXT,
  page_locale     TEXT,
  page_title      TEXT,
  device_ua       TEXT,
  device_type     TEXT,
  device_locale   TEXT,
  props_json      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dddk_events_timestamp      ON dddk_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_dddk_events_category_kind  ON dddk_events(category, kind);
CREATE INDEX IF NOT EXISTS idx_dddk_events_session        ON dddk_events(session_id);
`;

/** MySQL DDL. `BIGINT` timestamp; utf8mb4 collation to accept any prop. */
export const DDDK_EVENTS_DDL_MYSQL = `\
CREATE TABLE IF NOT EXISTS dddk_events (
  id              VARCHAR(64) PRIMARY KEY,
  schema_version  VARCHAR(32) NOT NULL,
  category        VARCHAR(32) NOT NULL,
  kind            VARCHAR(64) NOT NULL,
  timestamp       BIGINT NOT NULL,
  org_id          VARCHAR(128),
  visitor_id      VARCHAR(128),
  session_id      VARCHAR(128),
  run_id          VARCHAR(128),
  page_path       VARCHAR(512),
  page_locale     VARCHAR(32),
  page_title      VARCHAR(512),
  device_ua       VARCHAR(512),
  device_type     VARCHAR(32),
  device_locale   VARCHAR(32),
  props_json      LONGTEXT NOT NULL,
  INDEX idx_dddk_events_timestamp     (timestamp),
  INDEX idx_dddk_events_category_kind (category, kind),
  INDEX idx_dddk_events_session       (session_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * Pick the DDL for a given dialect. Hosts on other engines should
 * read the column list + types above and write their own.
 */
export type SqlDialect = 'sqlite' | 'postgres' | 'mysql';
export function dddkEventsDDL(dialect: SqlDialect): string {
  switch (dialect) {
    case 'sqlite':   return DDDK_EVENTS_DDL_SQLITE;
    case 'postgres': return DDDK_EVENTS_DDL_POSTGRES;
    case 'mysql':    return DDDK_EVENTS_DDL_MYSQL;
  }
}

// ─── Row ↔ Event conversion ───────────────────────────────────────

/** Flatten an event into the canonical SQL row shape. Lossless. */
export function eventToRow(event: BaseEvent): DddkEventRow {
  return {
    id: event.id,
    schema_version: event.schemaVersion,
    category: event.category,
    kind: event.kind,
    timestamp: event.timestamp,
    org_id: event.orgId ?? null,
    visitor_id: event.visitorId ?? null,
    session_id: event.sessionId ?? null,
    run_id: event.runId ?? null,
    page_path: event.page?.path ?? null,
    page_locale: event.page?.locale ?? null,
    page_title: event.page?.title ?? null,
    device_ua: event.device?.ua ?? null,
    device_type: event.device?.deviceType ?? null,
    device_locale: event.device?.locale ?? null,
    props_json: event.props ? JSON.stringify(event.props) : '{}',
  };
}

/** Reverse — useful when reading rows back from SQL to feed analytics
 *  code that expects `BaseEvent`. Throws on malformed `props_json`. */
export function rowToEvent(row: DddkEventRow): BaseEvent {
  let props: Record<string, unknown> | undefined;
  if (row.props_json && row.props_json !== '{}') {
    try {
      const parsed = JSON.parse(row.props_json);
      if (parsed && typeof parsed === 'object') props = parsed as Record<string, unknown>;
    } catch (err) {
      throw new Error(`rowToEvent: props_json is not valid JSON for event ${row.id}: ${String(err)}`);
    }
  }
  const page = row.page_path != null || row.page_locale != null || row.page_title != null
    ? {
        path: row.page_path ?? '',
        locale: row.page_locale ?? undefined,
        title: row.page_title ?? undefined,
      }
    : undefined;
  const device = row.device_ua != null || row.device_type != null || row.device_locale != null
    ? {
        ua: row.device_ua ?? undefined,
        deviceType: (row.device_type as BaseEvent['device'] extends infer D ? D extends { deviceType?: infer T } ? T : never : never) ?? undefined,
        locale: row.device_locale ?? undefined,
      }
    : undefined;
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    category: row.category as BaseEvent['category'],
    kind: row.kind,
    timestamp: row.timestamp,
    orgId: row.org_id ?? undefined,
    visitorId: row.visitor_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    runId: row.run_id ?? undefined,
    page,
    device,
    props,
  };
}
