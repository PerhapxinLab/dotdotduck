/**
 * Self-hosted analytics layer — local event store + canonical SQL
 * schema + exporters + mappable rows.
 *
 * This is the OSS-friendly path: the host runs dddk, the SDK keeps a
 * rolling local copy of every emitted event in the visitor's
 * browser, the host queries / exports whenever they want without
 * needing a cloud aggregation backend. Cloud (cross-tenant +
 * RL-trajectory export) lives in dddk-console.
 *
 *   import { EventStore, defaultMapper, toCSV, toSQL } from '@perhapxin/dddk/analytics';
 *
 *   const store = await EventStore.open({ cap: { maxEvents: 100_000 } });
 *   // Wire as an EventSink:
 *   transport.addSink(store.sink());
 *   // Query:
 *   const last10 = await store.query({ category: 'intent', limit: 10 });
 *   // Export:
 *   const csv = toCSV(last10);
 *   const sql = toSQL(last10, { dialect: 'postgres', includeDDL: true });
 */

export { EventStore } from './store';
export type {
  Cap,
  CapInfo,
  EventStoreOpts,
  EventQuery,
  OnFullPolicy,
  NotifyHostHandler,
} from './store';

export {
  defaultMapper,
  fieldMapper,
  filterEvents,
} from './mapper';
export type { SqlSchemaMapper } from './mapper';

export {
  eventToRow,
  rowToEvent,
  dddkEventsDDL,
  DDDK_EVENTS_COLUMNS,
  DDDK_EVENTS_DDL_SQLITE,
  DDDK_EVENTS_DDL_POSTGRES,
  DDDK_EVENTS_DDL_MYSQL,
} from './sql-schema';
export type { DddkEventRow, SqlDialect } from './sql-schema';

export {
  toCSV,
  toNDJSON,
  toSQL,
} from './export';
export type {
  ToCSVOptions,
  ToNDJSONOptions,
  ToSQLOptions,
} from './export';
