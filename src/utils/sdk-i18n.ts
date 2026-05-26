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
    'palette.section.settings': 'Settings',
    'palette.section.go_to': 'Go to',
    'palette.section.ai': 'AI',
    'palette.section.commands': 'Commands',
    'palette.section.docs': 'Docs',
  },
  'zh-TW': {
    'agent.thinking': '思考中…',
    'agent.running': 'Agent 執行中…',
    'agent.processing': '處理中…',
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
    'palette.section.settings': '設定',
    'palette.section.go_to': '前往',
    'palette.section.ai': 'AI',
    'palette.section.commands': '指令',
    'palette.section.docs': '文件',
  },
} as const;

export type SdkI18nKey = keyof typeof STRINGS['en'];

/**
 * Look up the bundled string for `key` in the given locale. Falls back
 * to English when the locale isn't bundled. Hosts that want native
 * strings for `ja` / `es` / `fr` etc. should NOT call this — they
 * override at the module config level instead.
 */
export function sdkString(locale: string | undefined, key: SdkI18nKey): string {
  const dict = (STRINGS as unknown as Record<string, Record<string, string>>)[locale ?? 'en'];
  return dict?.[key] ?? STRINGS.en[key];
}
