/**
 * Google provider entry point.
 *
 * Implementation is split across ./provider.ts / ./stream.ts / ./transform.ts.
 * Callers always import via this file (`from '../google'`) so the internal
 * split is invisible to the rest of the package.
 */

export { GoogleProvider, type GoogleProviderConfig } from './provider';
