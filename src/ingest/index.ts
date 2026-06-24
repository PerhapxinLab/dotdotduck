/**
 * Unified ingest layer — schemas + transport for v0.2.0.
 *
 * Routes every event the SDK emits (intent / interaction / lifecycle /
 * audit / experiment / custom) through one canonical pipeline. Hosts
 * wire a sink to send batches anywhere — own backend, a hosted
 * console, a BI warehouse, or just `console.log` for development.
 */

export {
  EVENT_SCHEMA_VERSION,
  makeEvent,
} from './schema';
export type {
  EventCategory,
  BaseEvent,
  ClickEventProps,
  ScrollEventProps,
  HoverEventProps,
  FocusEventProps,
  RoutingEventProps,
  PerformanceEventProps,
  SessionStartProps,
  PageViewProps,
  CustomEventProps,
} from './schema';

export {
  Transport,
  HttpSink,
  DebugSink,
  MultiSink,
} from './transport';
export type {
  EventSink,
  TransportOptions,
} from './transport';
