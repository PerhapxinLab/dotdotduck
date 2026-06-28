/**
 * Default `screenshot` context provider.
 *
 * Returns the viewport as a data-URL PNG. Lazy-resolves
 * `captureScreenshots` from the SDK's screenshot module so this
 * file doesn't pull the html2canvas peer dep until a host actually
 * asks for a screenshot.
 *
 * Returns `null` when:
 *   - There's no `document` (SSR / Node).
 *   - `html2canvas` is missing (silent — matches the runtime's
 *     existing screenshot-config behavior).
 *
 * Hosts override when the page is canvas / WebGL based and the
 * default rasterizer can't capture it — e.g. they already have a
 * scene-graph snapshot and just want to hand it off as a data URL.
 */

import type { ContextProvider } from '../types';
import { captureScreenshots } from '../screenshot';

export const defaultScreenshotProvider: ContextProvider = async () => {
  if (typeof document === 'undefined') return null;
  try {
    const images = await captureScreenshots({ mode: 'viewport' });
    return images.length > 0 ? images[0]! : null;
  } catch {
    return null;
  }
};
