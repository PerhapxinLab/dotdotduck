/**
 * Subtitle bar stylesheet — injected on first paint via `ensureStyles`.
 * Positioning lives in ../placement.ts; this file only owns chrome,
 * typography, scroll behaviour, indicator + choice + streaming visuals.
 */

import { injectScopedStyle, UI_ATTR } from '../../utils/dom';

export const STYLE_ID = 'dddk-subtitle-style';

export function ensureStyles(): void {
  injectScopedStyle(STYLE_ID, `
    /* Theming prefers host-bridged tokens (--dddk-bg-elevated / --dddk-text
     * / --dddk-border) so a host that defines a dark theme via those
     * tokens gets a properly-themed bar without overriding --dddk-bar-bg. */
    [${UI_ATTR}="bar"] {
      position: relative;
      background: var(--dddk-bar-bg, var(--dddk-bg-elevated, rgba(255, 255, 255, 0.985)));
      color: var(--dddk-bar-text, var(--dddk-text, #1a1a1a));
      border: 1px solid var(--dddk-bar-border, var(--dddk-border, rgba(0, 0, 0, 0.08)));
      border-radius: var(--dddk-bar-radius, 16px);
      box-shadow: var(--dddk-bar-shadow, 0 18px 48px -12px rgba(0, 0, 0, 0.32), 0 4px 14px rgba(0, 0, 0, 0.08));
      padding: 0;
      font-family: var(--dddk-bar-font, var(--dddk-font, system-ui, -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif));
      font-size: var(--dddk-bar-font-size, 15.5px);
      line-height: 1.65;
      letter-spacing: 0.005em;
      backdrop-filter: blur(var(--dddk-blur, 18px));
      -webkit-backdrop-filter: blur(var(--dddk-blur, 18px));
    }
    [${UI_ATTR}="bar-scroll"] {
      max-height: var(--dddk-bar-max-height, min(52vh, 460px));
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 18px 56px 18px 22px;
      display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin;
      scrollbar-color: var(--dddk-border, rgba(0,0,0,0.18)) transparent;
    }
    [${UI_ATTR}="bar-scroll"]::-webkit-scrollbar { width: 8px; }
    [${UI_ATTR}="bar-scroll"]::-webkit-scrollbar-track { background: transparent; }
    [${UI_ATTR}="bar-scroll"]::-webkit-scrollbar-thumb {
      background: var(--dddk-border, rgba(0,0,0,0.18));
      border-radius: 4px;
    }
    [${UI_ATTR}="bar-close"] {
      position: absolute;
      top: 10px; right: 10px;
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--dddk-close-bg, rgba(0,0,0,0.05));
      color: var(--dddk-close-fg, var(--dddk-text, #1a1a1a));
      border: 1px solid var(--dddk-close-border, rgba(0,0,0,0.08));
      border-radius: 10px;
      font-size: 18px; line-height: 1;
      font-weight: 500;
      cursor: pointer;
      padding: 0;
      transition: background 0.12s, color 0.12s, border-color 0.12s, transform 0.08s;
      z-index: 2;
      -webkit-tap-highlight-color: transparent;
    }
    [${UI_ATTR}="bar-close"]:hover {
      background: var(--dddk-close-bg-hover, rgba(0,0,0,0.1));
      border-color: var(--dddk-close-border-hover, rgba(0,0,0,0.16));
    }
    [${UI_ATTR}="bar-close"]:focus-visible {
      outline: 2px solid var(--dddk-accent, #6366f1);
      outline-offset: 2px;
    }
    [${UI_ATTR}="bar-close"]:active { transform: scale(0.92); }
    [${UI_ATTR}="bar-hints"] {
      color: var(--dddk-bar-hints, var(--dddk-text-muted, #6b7280));
      font-size: var(--dddk-font-size-sm, 12.5px);
      margin-top: 2px;
    }
    [${UI_ATTR}="bar-text"] { line-height: 1.65; font-size: inherit; }
    /* Streaming mode: a blinking block cursor sits at the tail of the
       live Text node so users know more text is on the way. */
    [${UI_ATTR}="bar"][data-dddk-bar-mode="streaming"] [${UI_ATTR}="bar-text"] {
      white-space: pre-wrap;
      word-break: break-word;
    }
    [${UI_ATTR}="streaming-cursor"] {
      display: inline-block;
      margin-left: 2px;
      color: var(--dddk-accent, #6366f1);
      animation: dddk-cursor-blink 1s steps(2) infinite;
      font-weight: 400;
      transform: translateY(-1px);
    }
    [${UI_ATTR}="bar"][data-dddk-bar-mode="streaming-done"] [${UI_ATTR}="bar-text"] {
      white-space: pre-wrap;
      word-break: break-word;
    }
    @keyframes dddk-cursor-blink {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0; }
    }
    /* Pause hint attaches BELOW the streamed text without replacing the
       bar, so the user can finish reading before deciding. */
    [${UI_ATTR}="streaming-pause"] {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed var(--dddk-border, rgba(0, 0, 0, 0.12));
      display: flex; flex-direction: column; gap: 4px;
    }
    [${UI_ATTR}="streaming-pause-text"] {
      font-size: var(--dddk-font-size-md, 14.5px);
      color: var(--dddk-text, #1a1a1a);
    }
    [${UI_ATTR}="streaming-pause-hints"] {
      font-size: var(--dddk-font-size-sm, 12.5px);
      color: var(--dddk-text-muted, #6b7280);
    }
    [${UI_ATTR}="bar-text"] strong { font-weight: 700; }
    [${UI_ATTR}="bar-text"] em { font-style: italic; }
    [${UI_ATTR}="bar-text"] code {
      font-family: var(--dddk-mono, ui-monospace, "SF Mono", Menlo, monospace);
      font-size: 0.92em;
      padding: 1px 5px;
      background: var(--dddk-row-hover, rgba(0,0,0,0.06));
      border-radius: 4px;
    }
    [${UI_ATTR}="bar-text"] ul,
    [${UI_ATTR}="bar-text"] ol {
      margin: 6px 0 6px 0;
      padding-left: 20px;
    }
    [${UI_ATTR}="bar-text"] li { margin: 2px 0; }
    [${UI_ATTR}="bar-text"] a {
      color: var(--dddk-accent, #6366f1);
      text-decoration: underline;
    }
    [${UI_ATTR}="bar-hints"] {
      font-size: var(--dddk-font-size-sm, 12px);
    }
    [${UI_ATTR}="bar-buttons"] {
      display: flex; gap: 8px; justify-content: flex-end;
      margin-top: 4px;
    }
    [${UI_ATTR}="bar-buttons"] button {
      border: 0;
      /* 44x44 minimum tap target per WCAG. */
      min-width: 44px; min-height: 36px;
      padding: 6px 16px;
      border-radius: var(--dddk-radius-sm, 6px);
      background: var(--dddk-accent, #ec4899);
      color: var(--dddk-text-on-accent, #fff);
      cursor: pointer;
      font-size: var(--dddk-font-size-md, 14px);
      font-weight: 600;
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.1s, transform 0.08s;
    }
    [${UI_ATTR}="bar-buttons"] button:hover {
      background: var(--dddk-accent-hover, #db2777);
    }
    [${UI_ATTR}="bar-buttons"] button:active {
      transform: scale(0.96);
    }
    /* Reject reads as secondary so accept stays the primary action. */
    [${UI_ATTR}="bar-buttons"] button[data-dddk-action="reject"] {
      background: transparent;
      color: var(--dddk-text-muted, #6b6b6b);
      border: 1px solid var(--dddk-border, rgba(0,0,0,0.15));
    }
    [${UI_ATTR}="bar-buttons"] button[data-dddk-action="reject"]:hover {
      background: var(--dddk-row-hover, rgba(0,0,0,0.04));
      color: var(--dddk-text, #1a1a1a);
    }
    /* Multi-choice mode — question + N numbered rows + optional
       free-text input + hint line. */
    [${UI_ATTR}="choice-list"] {
      display: flex; flex-direction: column; gap: 4px;
      margin: 4px 0 2px;
    }
    [${UI_ATTR}="choice-row"] {
      display: flex; align-items: center; gap: 10px;
      width: 100%;
      padding: 7px 10px;
      border: 1px solid transparent;
      border-radius: var(--dddk-radius-sm, 6px);
      background: var(--dddk-row-bg, transparent);
      color: inherit;
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    [${UI_ATTR}="choice-row"]:hover,
    [${UI_ATTR}="choice-row"]:focus-visible {
      background: var(--dddk-row-hover, rgba(0,0,0,0.05));
      border-color: var(--dddk-border-subtle, rgba(0,0,0,0.08));
      outline: none;
    }
    [${UI_ATTR}="choice-key"] {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 22px; height: 20px;
      padding: 0 6px;
      border-radius: 4px;
      background: var(--dddk-kbd-bg, rgba(0,0,0,0.06));
      color: var(--dddk-text-muted, #6b6b6b);
      font-size: 11px;
      font-family: var(--dddk-mono, ui-monospace, monospace);
      font-weight: 600;
    }
    [${UI_ATTR}="choice-label"] { font-size: var(--dddk-font-size-md, 14px); }
    [${UI_ATTR}="choice-freetext"] { margin-top: 4px; }
    [${UI_ATTR}="choice-input"] {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid var(--dddk-border, rgba(0,0,0,0.12));
      border-radius: var(--dddk-radius-sm, 6px);
      background: var(--dddk-input-bg, transparent);
      color: inherit;
      font: inherit;
    }
    [${UI_ATTR}="choice-input"]:focus {
      outline: none;
      border-color: var(--dddk-accent, #ec4899);
    }
    /* Indicator background uses ACCENT (not bg-elevated) so it stays
       visible on dark themes; "listening" gets a pulsing ring so the
       hot mic state is obvious. */
    [${UI_ATTR}="indicator"] {
      background: var(--dddk-accent, #6366f1);
      color: var(--dddk-text-on-accent, #fff);
      border-radius: var(--dddk-radius-pill, 999px);
      padding: 10px 20px;
      box-shadow: var(--dddk-shadow-md, 0 6px 20px rgba(0,0,0,0.25));
      display: flex; align-items: center; gap: 10px;
      font-size: var(--dddk-font-size-md, 14px);
      font-weight: 600;
      border: 1px solid rgba(255,255,255,0.15);
    }
    @media (max-width: 480px) {
      [${UI_ATTR}="indicator"] {
        padding: 6px 14px;
        gap: 8px;
        font-size: var(--dddk-font-size-sm, 13px);
      }
      [${UI_ATTR}="indicator-dots"] span {
        width: 6px; height: 6px;
      }
      [${UI_ATTR}="indicator-check"] {
        font-size: 14px;
      }
    }
    [${UI_ATTR}="indicator"][data-state="listening"] {
      animation: dddk-indicator-pulse 1.4s ease-in-out infinite;
    }
    [${UI_ATTR}="indicator"][data-state="done"] {
      background: var(--dddk-success, #16a34a);
    }
    [${UI_ATTR}="indicator-check"] {
      font-size: 16px; line-height: 1;
    }
    [${UI_ATTR}="indicator-dots"] {
      display: inline-flex; gap: 4px;
    }
    [${UI_ATTR}="indicator-dots"] span {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--dddk-text-on-accent, #fff);
      animation: dddk-dot-bounce 1.2s infinite ease-in-out;
    }
    [${UI_ATTR}="indicator-dots"] span:nth-child(2) { animation-delay: 0.15s; }
    [${UI_ATTR}="indicator-dots"] span:nth-child(3) { animation-delay: 0.3s; }
    [${UI_ATTR}="indicator-label"] { letter-spacing: 0.02em; }
    @keyframes dddk-dot-bounce {
      0%, 80%, 100% { transform: scale(0.7); opacity: 0.55; }
      40% { transform: scale(1); opacity: 1; }
    }
    @keyframes dddk-indicator-pulse {
      0%, 100% {
        box-shadow:
          var(--dddk-shadow-md, 0 6px 20px rgba(0,0,0,0.25)),
          0 0 0 0 rgba(99, 102, 241, 0.55);
      }
      50% {
        box-shadow:
          var(--dddk-shadow-md, 0 6px 20px rgba(0,0,0,0.25)),
          0 0 0 12px rgba(99, 102, 241, 0);
      }
    }
  `);
}
