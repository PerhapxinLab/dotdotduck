/**
 * Built-in i18n strings + default translate targets for InlineAgent.
 * Kept separate so the main module stays focused on UI / LLM wiring.
 */

export const I18N = {
  en: {
    header: 'EDIT WITH AI',
    translate: 'Translate',
    improve: 'Improve writing',
    fix: 'Fix spelling & grammar',
    shorter: 'Make shorter',
    longer: 'Make longer',
    tone: 'Change to professional tone',
    explain: 'Explain this',
    pickLanguage: 'Translate to…',
    cancel: 'Cancel',
    processing: 'Working…',
    failed: 'Failed',
  },
  'zh-TW': {
    header: '用 AI 編輯',
    translate: '翻譯',
    improve: '改寫',
    fix: '修文法',
    shorter: '縮短',
    longer: '延長',
    tone: '改成正式語氣',
    explain: '解釋',
    pickLanguage: '翻譯成…',
    cancel: '取消',
    processing: '處理中…',
    failed: '失敗',
  },
} as const;

export type InlineLocale = keyof typeof I18N;
export type InlineI18nKey = keyof typeof I18N['en'];

export const DEFAULT_TRANSLATE_TARGETS = [
  { code: 'en',    label: 'English' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'ja',    label: '日本語' },
  { code: 'ko',    label: '한국어' },
  { code: 'es',    label: 'Español' },
  { code: 'fr',    label: 'Français' },
  { code: 'de',    label: 'Deutsch' },
];
