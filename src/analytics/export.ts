/**
 * Exporters — turn events into a string the host can save, share, or
 * paste straight into a SQL client.
 *
 * Three formats out of the box: CSV, NDJSON, SQL. Each runs the event
 * through an optional `SqlSchemaMapper` first so hosts can reshape
 * rows to match their own destination schema. Default mapper produces
 * canonical `DddkEventRow` (see `sql-schema.ts`).
 *
 * Returns strings — not files. Hosts decide where they go: download
 * via `URL.createObjectURL`, copy to clipboard, paste into their own
 * upload pipeline, whatever. Keeping the exporters string-pure means
 * they work everywhere (browser / Node / Workers) and never touch
 * the filesystem.
 */

import type { BaseEvent } from '../ingest/schema';
import { defaultMapper, type SqlSchemaMapper } from './mapper';
import { DDDK_EVENTS_COLUMNS, type SqlDialect, dddkEventsDDL } from './sql-schema';

// ─── CSV ──────────────────────────────────────────────────────

export interface ToCSVOptions {
  /** Mapper. Default: canonical row. */
  mapper?: SqlSchemaMapper;
  /** Restrict to these columns in the given order. Default: use the
   *  union of all keys appearing in the mapped rows, sorted to a
   *  stable order. */
  columns?: string[];
  /** Field delimiter. Default `,`. Use `\t` for TSV. */
  delimiter?: string;
  /** Line ending. Default `\n`. */
  lineEnding?: string;
  /** Emit the header row. Default `true`. */
  header?: boolean;
}

/**
 * RFC-4180-ish CSV. Quotes any field that contains the delimiter, a
 * quote, a newline, or starts/ends with whitespace. Empty / null
 * fields render as empty (NOT the literal string "null").
 */
export function toCSV(events: BaseEvent[], opts: ToCSVOptions = {}): string {
  const mapper = opts.mapper ?? defaultMapper;
  const delimiter = opts.delimiter ?? ',';
  const lineEnding = opts.lineEnding ?? '\n';
  const wantHeader = opts.header ?? true;

  const rows: Record<string, unknown>[] = [];
  for (const ev of events) {
    const row = mapper(ev);
    if (row !== null) rows.push(row as Record<string, unknown>);
  }

  const columns = opts.columns ?? collectColumns(rows);
  const out: string[] = [];
  if (wantHeader) {
    out.push(columns.map((c) => escapeCsvField(c, delimiter)).join(delimiter));
  }
  for (const row of rows) {
    out.push(columns.map((c) => escapeCsvField(row[c], delimiter)).join(delimiter));
  }
  return out.join(lineEnding) + (out.length > 0 ? lineEnding : '');
}

function escapeCsvField(v: unknown, delimiter: string): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
  else s = JSON.stringify(v);
  // Wrap in quotes if the field contains the delimiter, a quote, a
  // newline, or leading/trailing whitespace.
  const needsQuote = s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')
    || /^\s|\s$/.test(s);
  if (!needsQuote) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return Array.from(DDDK_EVENTS_COLUMNS);
  const seen = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) seen.add(k);
  return Array.from(seen).sort();
}

// ─── NDJSON ───────────────────────────────────────────────────

export interface ToNDJSONOptions {
  /** Mapper. Default: canonical row. */
  mapper?: SqlSchemaMapper;
  /** Line ending. Default `\n` — keep it for tools that strictly
   *  parse NDJSON. */
  lineEnding?: string;
}

/**
 * Newline-delimited JSON. One JSON object per line. Pipes cleanly
 * into `jq`, BigQuery `bq load`, ClickHouse `INSERT FROM INFILE`,
 * etc.
 */
export function toNDJSON(events: BaseEvent[], opts: ToNDJSONOptions = {}): string {
  const mapper = opts.mapper ?? defaultMapper;
  const lineEnding = opts.lineEnding ?? '\n';
  const lines: string[] = [];
  for (const ev of events) {
    const row = mapper(ev);
    if (row !== null) lines.push(JSON.stringify(row));
  }
  return lines.length > 0 ? lines.join(lineEnding) + lineEnding : '';
}

// ─── SQL ──────────────────────────────────────────────────────

export interface ToSQLOptions {
  /** Mapper. Default: canonical row. */
  mapper?: SqlSchemaMapper;
  /** Destination table. Default `'dddk_events'`. */
  table?: string;
  /** Dialect — drives identifier quoting + the prepended DDL.
   *  Default `'sqlite'`. */
  dialect?: SqlDialect;
  /** Restrict to these columns. Default: union of mapped row keys. */
  columns?: string[];
  /** Prepend `CREATE TABLE IF NOT EXISTS …`. Default `false` —
   *  most hosts run the migration once, not per-export. */
  includeDDL?: boolean;
  /** Batch inserts into multi-row VALUES groups of this size.
   *  Default `100`. Drop to `1` for one INSERT per event when
   *  debugging. Many SQL engines cap parsed statement size; 100
   *  keeps each statement well under typical limits. */
  batchSize?: number;
}

/**
 * Produce a runnable SQL script. Identifier + value quoting follows
 * each dialect's convention. Hosts should pipe the output straight
 * into their SQL client OR wrap in a transaction at the call site.
 */
export function toSQL(events: BaseEvent[], opts: ToSQLOptions = {}): string {
  const mapper = opts.mapper ?? defaultMapper;
  const table = opts.table ?? 'dddk_events';
  const dialect = opts.dialect ?? 'sqlite';
  const batchSize = Math.max(1, opts.batchSize ?? 100);

  const rows: Record<string, unknown>[] = [];
  for (const ev of events) {
    const row = mapper(ev);
    if (row !== null) rows.push(row as Record<string, unknown>);
  }
  const columns = opts.columns ?? collectColumns(rows);

  const parts: string[] = [];
  if (opts.includeDDL) {
    parts.push(dddkEventsDDL(dialect).trim());
    parts.push('');
  }
  if (rows.length === 0) return parts.join('\n');

  const qIdent = (s: string) => quoteIdent(s, dialect);
  const colList = columns.map(qIdent).join(', ');

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = chunk
      .map((row) => '(' + columns.map((c) => quoteValue(row[c], dialect)).join(', ') + ')')
      .join(',\n  ');
    parts.push(`INSERT INTO ${qIdent(table)} (${colList}) VALUES\n  ${values};`);
  }
  return parts.join('\n');
}

function quoteIdent(name: string, dialect: SqlDialect): string {
  // Reject anything that isn't a normal-looking identifier; this is a
  // belt-and-braces guard, callers shouldn't be feeding hostile names
  // here, but exporters are easy to misuse.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`toSQL: invalid identifier ${JSON.stringify(name)} — only [A-Za-z_][A-Za-z0-9_]* allowed`);
  }
  if (dialect === 'mysql') return '`' + name + '`';
  return '"' + name + '"';
}

function quoteValue(v: unknown, dialect: SqlDialect): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'NULL';
    return String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'string') return escapeSqlString(v, dialect);
  // Objects, arrays — JSON-encode then quote as string.
  return escapeSqlString(JSON.stringify(v), dialect);
}

function escapeSqlString(s: string, dialect: SqlDialect): string {
  // Standard SQL single-quote escaping (double the quote) works on
  // SQLite + Postgres + MySQL. We deliberately don't lean on the
  // backslash-escape convention because Postgres standard_conforming_strings
  // makes it dialect-state-dependent.
  const escaped = s.replace(/'/g, "''");
  // MySQL also recognises backslash escapes — escape them too so the
  // value can't break out of the literal via `\\`.
  if (dialect === 'mysql') return "'" + escaped.replace(/\\/g, '\\\\') + "'";
  return "'" + escaped + "'";
}
