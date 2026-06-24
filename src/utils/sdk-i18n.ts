/**
 * SDK-wide UI string table. Centralises the user-visible labels that
 * modules render directly (palette item names, button captions, the
 * agent status indicator) so they pick up the host's locale instead of
 * defaulting to a hardcoded language. Bundled languages are `en` and
 * `zh-TW`; any other locale falls back to `en` so a Japanese / Spanish
 * site never breaks — those hosts override per-module via config.
 *
 * NOT a general-purpose i18n framework. dddk's module-level i18n
 * (subtitle hints, inline-agent menu) lives next to each module. This
 * file is only for the small set of strings that DotDotDuck itself
 * renders without going through a module.
 */
const STRINGS = {
  en: {
    'agent.thinking': 'Thinking…',
    'agent.running': 'Agent running…',
    'agent.processing': 'Working…',
    'agent.loading': 'Loading the page…',
    'agent.done': '✓ Done',
    'agent.press_space_close': 'press space to close',
    'agent.press_space_continue': 'space → next · double space → exit',
    'agent.tap_to_continue': 'tap → next · double-tap → exit',
    'agent.space_continue_reject': 'space → next · double space → exit',
    'agent.tap_to_dismiss': 'tap to dismiss',
    'agent.stop_close': 'Agent stopped — say something new when you\'re ready',
    'agent.stop_esc': 'Esc received — agent stopped',
    'agent.stop_reject': 'Double-tap reject received — agent stopped',
    // Confirmation copy for destructive / requireConfirmation tool calls.
    // `{target}` / `{path}` / `{action}` placeholders interpolated at call time.
    'agent.confirm.suffix': '— press space to confirm',
    'agent.confirm.navigate.with_path': 'Take you to {path}',
    'agent.confirm.navigate.no_path': 'Switch page',
    'agent.confirm.click.with_target': 'Click {target}',
    'agent.confirm.click.no_target': 'Click',
    'agent.confirm.fill_input.with_target': 'Fill {target}',
    'agent.confirm.fill_input.no_target': 'Fill field',
    'agent.confirm.delete.with_target': 'Delete {target}',
    'agent.confirm.delete.no_target': 'Delete',
    'agent.confirm.generic.with_target': 'Run {action} → {target}',
    'agent.confirm.generic.no_target': 'Run {action}',
    'palette.theme.light': 'Theme: light',
    'palette.theme.dark': 'Theme: dark',
    'palette.theme.system': 'Theme: follow system',
    'palette.language.current': '✓ Active',
    'palette.onboarding.replay': 'Replay tour',
    'form.required': 'This field is required',
    'form.submit': 'Submit',
    'form.assist.fill': '✦ AI fill',
    'proactive.yes': 'Yes',
    'proactive.no': 'No',
    'fallback.empty': 'No data',
    'fallback.error': 'Error',
    'palette.placeholder': 'Search commands or page…',
    'palette.footer.navigate': 'to navigate',
    'palette.footer.select': 'to select',
    'palette.footer.close': 'to close',
    'palette.footer.back': 'to go back',
    'palette.section.settings': 'Settings',
    'palette.section.go_to': 'Go to',
    'palette.section.ai': 'AI',
    'palette.section.commands': 'Commands',
    'palette.section.docs': 'Docs',
    'palette.screenshot.hint': 'Drag to select · Esc cancels',
    'form.assist.scanning': 'Scanning {count} fields…',
    'prefs.title': 'Settings: {skill}',
    // v0.2.0 ROADMAP 1.3 — voice module labels in the SDK i18n fallback
    'voice.listening': 'Listening',
    'voice.unsupported': 'Voice input not supported',
    'voice.failed': 'Voice input failed',
  },
  'zh-TW': {
    'agent.thinking': '思考中…',
    'agent.running': 'Agent 執行中…',
    'agent.processing': '處理中…',
    'agent.loading': '頁面載入中…',
    'agent.done': '✓ 執行完畢',
    'agent.press_space_close': '按 space 關閉',
    'agent.press_space_continue': 'space 下一步 ｜ 兩下 space 直接結束',
    'agent.tap_to_continue': '點一下下一步 ｜ 兩下直接結束',
    'agent.space_continue_reject': 'space 下一步 ｜ 兩下 space 直接結束',
    'agent.tap_to_dismiss': '點一下關閉',
    'agent.stop_close': 'Agent 已停下，想到新的就直接打或按住 space',
    'agent.stop_esc': '收到 esc，agent 已停下',
    'agent.stop_reject': '收到雙擊 space 拒絕，agent 已停下',
    'agent.confirm.suffix': '— 按 space 確認',
    'agent.confirm.navigate.with_path': '帶你到 {path}',
    'agent.confirm.navigate.no_path': '切換頁面',
    'agent.confirm.click.with_target': '點擊 {target}',
    'agent.confirm.click.no_target': '點擊',
    'agent.confirm.fill_input.with_target': '填寫 {target}',
    'agent.confirm.fill_input.no_target': '填寫欄位',
    'agent.confirm.delete.with_target': '刪除 {target}',
    'agent.confirm.delete.no_target': '刪除',
    'agent.confirm.generic.with_target': '執行 {action} → {target}',
    'agent.confirm.generic.no_target': '執行 {action}',
    'palette.theme.light': '主題:亮色',
    'palette.theme.dark': '主題:暗色',
    'palette.theme.system': '主題:跟隨系統',
    'palette.language.current': '✓ 目前',
    'palette.onboarding.replay': '重看導覽',
    'form.required': '此欄位必填',
    'form.submit': '儲存',
    'form.assist.fill': '✦ AI 填寫',
    'proactive.yes': '是',
    'proactive.no': '否',
    'fallback.empty': '無資料',
    'fallback.error': '錯誤',
    'palette.placeholder': '搜尋指令或頁面…',
    'palette.footer.navigate': '上下移動',
    'palette.footer.select': '選取',
    'palette.footer.close': '關閉',
    'palette.footer.back': '上一頁',
    'palette.section.settings': '設定',
    'palette.section.go_to': '前往',
    'palette.section.ai': 'AI',
    'palette.section.commands': '指令',
    'palette.section.docs': '文件',
    'palette.screenshot.hint': '拖曳框選 · Esc 取消',
    'form.assist.scanning': '正在分析 {count} 個欄位…',
    'prefs.title': '設定：{skill}',
    'voice.listening': '聽取中',
    'voice.unsupported': '此瀏覽器不支援語音輸入',
    'voice.failed': '語音輸入失敗',
  },
} as const;

export type SdkI18nKey = keyof typeof STRINGS['en'];

/**
 * Look up the bundled string for `key` in the given locale. Falls back
 * to English when the locale isn't bundled. Hosts that want native
 * strings for `ja` / `es` / `fr` etc. should NOT call this — they
 * override at the module config level (e.g. WebAgentConfig.confirmStrings).
 *
 * `vars` interpolates `{name}` placeholders, e.g.
 *   sdkString('en', 'agent.confirm.click.with_target', { target: 'button[3]' })
 *   → "Click button[3]"
 */
export function sdkString(
  locale: string | undefined,
  key: SdkI18nKey,
  vars?: Record<string, string | number>,
): string {
  const dict = (STRINGS as unknown as Record<string, Record<string, string>>)[locale ?? 'en'];
  let s = dict?.[key] ?? STRINGS.en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
