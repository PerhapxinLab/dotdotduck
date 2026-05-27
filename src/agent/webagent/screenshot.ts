/**
 * Screenshot capture for WebAgent — feeds the LLM a visual snapshot of
 * the page alongside the indexed DOM dump. Disabled by default; opt in
 * via `WebAgentConfig.screenshot`.
 *
 * Two modes:
 *   - `viewport`   — only what the user can see right now (1 image).
 *   - `full-page`  — the entire scroll height, split into N segments
 *                    when taller than `maxSegmentHeight`. Each segment
 *                    becomes its own image, capped by `maxImages`.
 *
 * Implementation: dynamic-imports `html2canvas` so users who don't
 * enable screenshots pay zero bundle cost. When a host turns the
 * feature on without installing the peer, capture silently no-ops and
 * the agent continues with text-only input.
 */

export type ScreenshotMode = 'viewport' | 'full-page';

export interface ScreenshotConfig {
  /** Default capture mode. Default `'viewport'`. */
  mode?: ScreenshotMode;
  /** Max pixel height per image segment. Full-page captures taller than
   *  this split into multiple images. Default 4000. */
  maxSegmentHeight?: number;
  /** Hard cap on the number of images sent per turn (after splitting).
   *  Default 3 — keeps token cost predictable. */
  maxImages?: number;
  /** JPEG quality 0–1. Default 0.75 (sweet spot for legibility vs. size). */
  quality?: number;
  /** Downscale factor — 1 = full resolution, 0.5 = half. Lower = cheaper
   *  tokens but blurrier text. Default 0.75. */
  scale?: number;
  /**
   * Override the capture function entirely. Host returns one image
   * (viewport mode) or many (full-page mode), each as a data URL or
   * remote URL the LLM can fetch. When provided, html2canvas is not
   * loaded.
   */
  capture?: (mode: ScreenshotMode) => Promise<string[]>;
}

interface H2COptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  windowWidth?: number;
  windowHeight?: number;
  scale?: number;
  useCORS?: boolean;
  backgroundColor?: string | null;
  logging?: boolean;
}
type H2CFn = (el: Element, opts?: H2COptions) => Promise<HTMLCanvasElement>;

let html2canvasCache: H2CFn | null | undefined;

async function loadHtml2Canvas(): Promise<H2CFn | null> {
  if (html2canvasCache !== undefined) return html2canvasCache;
  try {
    // Dynamic import via indirection so TypeScript doesn't try to resolve
    // the optional peer dependency at compile time, and so bundlers leave
    // html2canvas out of the default chunk. Users opt in to screenshots
    // by adding `pnpm add html2canvas`.
    const spec = 'html2canvas';
    const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
    const mod = await dynImport(spec);
    const m = mod as { default?: H2CFn };
    const fn = m.default ?? (mod as unknown as H2CFn);
    html2canvasCache = fn;
    return fn;
  } catch {
    html2canvasCache = null;
    return null;
  }
}

/**
 * Capture screenshot(s) of the current page according to `cfg`. Returns
 * an empty array when the host didn't install html2canvas (and didn't
 * provide a custom `capture`) — the agent loop continues without images.
 */
export async function captureScreenshots(cfg: ScreenshotConfig): Promise<string[]> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];

  const mode: ScreenshotMode = cfg.mode ?? 'viewport';
  const maxImages = Math.max(1, cfg.maxImages ?? 3);

  if (cfg.capture) {
    const imgs = await cfg.capture(mode);
    return imgs.slice(0, maxImages);
  }

  const h2c = await loadHtml2Canvas();
  if (!h2c) return [];

  const quality = clamp(cfg.quality ?? 0.75, 0.1, 1);
  const scale = clamp(cfg.scale ?? 0.75, 0.25, 2);
  const baseOpts: H2COptions = {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: null,
  };

  if (mode === 'viewport') {
    const canvas = await h2c(document.body, {
      ...baseOpts,
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    });
    return [canvas.toDataURL('image/jpeg', quality)];
  }

  // full-page: capture the whole document, segmented when very tall.
  const maxSeg = Math.max(800, cfg.maxSegmentHeight ?? 4000);
  const docHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
  );
  const width = Math.max(document.documentElement.clientWidth, window.innerWidth);
  const segments: string[] = [];

  for (let y = 0; y < docHeight && segments.length < maxImages; y += maxSeg) {
    const segHeight = Math.min(maxSeg, docHeight - y);
    const canvas = await h2c(document.body, {
      ...baseOpts,
      x: 0,
      y,
      width,
      height: segHeight,
      windowWidth: width,
      windowHeight: docHeight,
    });
    segments.push(canvas.toDataURL('image/jpeg', quality));
  }
  return segments;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
