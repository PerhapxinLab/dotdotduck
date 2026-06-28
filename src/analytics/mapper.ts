/**
 * Schema mapper — transform a `BaseEvent` into whatever row shape the
 * host's destination wants.
 *
 * The default mapper produces the canonical `DddkEventRow` (see
 * `sql-schema.ts`). Hosts on a different DB schema swap in their
 * own `(event) => row` and the rest of the pipeline (`EventStore`,
 * `toCSV`, `toNDJSON`, `toSQL`) honors it.
 *
 * Function-based (not declarative JSON) on purpose: declarative
 * mappings always run out of expressiveness around things like
 * "derive `customer_tier` from `props.tier` when present, else fall
 * back to `props.tier_hint`". Hosts write a function; we don't
 * invent a mapping DSL.
 *
 * Returning `null` from a mapper FILTERS the event out — useful when
 * a host wants to drop a category entirely (e.g. only ship intent
 * events to BI, drop interaction events that are too noisy).
 */

import type { BaseEvent } from '../ingest/schema';
import type { DddkEventRow } from './sql-schema';
import { eventToRow } from './sql-schema';

/**
 * Map a `BaseEvent` to an arbitrary row shape. Return `null` to drop
 * the event.
 */
export type SqlSchemaMapper<Row = Record<string, unknown>> = (event: BaseEvent) => Row | null;

/**
 * The bundled default — produces canonical `DddkEventRow`s. Use this
 * when your destination has run the `dddk_events` DDL unchanged.
 */
export const defaultMapper: SqlSchemaMapper<DddkEventRow> = (event) => eventToRow(event);

/**
 * Build a mapper from a column → extractor map. Hosts who just want
 * to rename a few columns or compute a derived one don't need to
 * write a full function — they describe the row column by column.
 *
 * ```ts
 * const m = fieldMapper({
 *   event_id:       (e) => e.id,
 *   event_name:     (e) => `${e.category}.${e.kind}`,
 *   ts_ms:          (e) => e.timestamp,
 *   props:          (e) => JSON.stringify(e.props ?? {}),
 *   customer_tier:  (e) => (e.props?.tier as string | undefined) ?? null,
 * });
 * ```
 *
 * Returning `null` from any extractor is fine — it lands as `null` in
 * the row. To DROP the whole event, wrap the mapper in a function
 * that returns `null` from the outer call.
 */
export function fieldMapper<Row extends Record<string, unknown>>(
  map: { [K in keyof Row]: (event: BaseEvent) => Row[K] },
): SqlSchemaMapper<Row> {
  const entries = Object.entries(map) as Array<[keyof Row, (e: BaseEvent) => Row[keyof Row]]>;
  return (event) => {
    const row = {} as Row;
    for (const [col, fn] of entries) {
      row[col] = fn(event);
    }
    return row;
  };
}

/**
 * Compose: filter THEN map. Returns a mapper that drops events for
 * which `predicate(event)` is false; events that pass get the inner
 * mapper applied.
 *
 * ```ts
 * const onlyIntent = filterEvents((e) => e.category === 'intent');
 * const m = onlyIntent(defaultMapper);
 * ```
 */
export function filterEvents(
  predicate: (event: BaseEvent) => boolean,
): <Row>(inner: SqlSchemaMapper<Row>) => SqlSchemaMapper<Row> {
  return <Row>(inner: SqlSchemaMapper<Row>) => (event) =>
    predicate(event) ? inner(event) : null;
}
