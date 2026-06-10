/**
 * QA palette helpers — locale-resolving wrappers around `addItem`. The
 * palette instance is passed in so the public `addQAItems` method on the
 * class stays a one-liner delegating here.
 */

import type {
  LocalizedText,
  PaletteItem,
  QAItemsOpts,
  QAPaletteItem,
} from './types';

export function resolveLocalized(value: LocalizedText, locale: string): string {
  if (typeof value === 'string') return value;
  const v = value[locale];
  if (v) return v;
  const en = value['en'];
  if (en) return en;
  for (const k of Object.keys(value)) return value[k]!;
  return '';
}

export function defaultQAAnswerSurface(ctx: {
  question: string;
  answer: string;
}): import('../../ui/pieces').PieceSurface {
  // Minimal Pieces tree — Stack { Heading, Body }. Hosts that want
  // richer formatting (markdown, code blocks, links) override via
  // `renderAnswer`.
  return {
    root: {
      kind: 'Stack',
      gap: 8,
      children: [
        { kind: 'Heading', text: ctx.question, level: 4 },
        { kind: 'Body', text: ctx.answer },
      ],
    },
  };
}

/**
 * Add a batch of QA items via the palette's `addItem`. Receives an
 * adder callback so the helper stays independent of the class shape.
 */
export function addQAItems(
  addItem: (item: PaletteItem) => void,
  items: QAPaletteItem[],
  opts: QAItemsOpts = {},
): void {
  const locale = opts.locale ?? 'en';
  const section = opts.section ?? 'QA';
  const icon = opts.icon ?? '?';
  const idPrefix = opts.idPrefix ?? 'qa-';
  const renderAnswer = opts.renderAnswer ?? defaultQAAnswerSurface;
  for (const item of items) {
    const question = resolveLocalized(item.question, locale);
    const answer = resolveLocalized(item.answer, locale);
    if (!question || !answer) continue;
    addItem({
      id: `${idPrefix}${item.id}`,
      name: question,
      description: item.description
        ? resolveLocalized(item.description, locale)
        : undefined,
      section,
      icon,
      category: item.category,
      detail: () => renderAnswer({ question, answer, meta: item.meta }),
      handler: (p) => p.close(),
    });
  }
}
