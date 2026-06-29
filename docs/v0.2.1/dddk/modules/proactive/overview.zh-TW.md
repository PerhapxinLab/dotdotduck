# Proactive

Tick 驅動的提示引擎。Host 註冊一組 prompt(「站內導覽」、「語音失
敗提示」、「商務頁停留」),host 自己驅動 tick,proactive 從 trigger
都成立的 prompt 中挑優先級最高的一個 fire — 受 session 級的疲勞上
限限制。

## 快速上手

```ts
import { createProactive, triggers } from '@perhapxin/dddk/modules/proactive';

const proactive = createProactive({
  analytics,                           // 選用:會發 proactive.shown / .response
  render: createSubtitleProactiveRender(dddk),
  isPaletteOpen: () => paletteOpen,
  whenPaletteOpen: 'suppress',
  fatigue: {
    maxPerSession: 2,
    cooldownMs: 30_000,
    consecutiveDismissCap: 1,
  },
});
await proactive.init();

proactive.register({
  id: 'commercial_dwell',
  priority: 10,
  triggers: [
    triggers.pageMatch({ path: '/commercial' }),
    triggers.dwell({ ms: 30_000 }),
  ],
  surface: {
    text: '看完了嗎?要不要看整合 docs?',
    yesLabel: '看 docs',
    noLabel: '還沒',
  },
  onResponse: (r) => { if (r === 'yes') goto('/docs'); },
});

// 用你自己的時鐘 tick — proactive 不會自己 tick。
setInterval(() => {
  void proactive.tick({
    page: location.pathname,
    dwellMs: Date.now() - pageEnterAt,
    customMeta: { firstVisit: isFirstVisit },
  });
}, 5000);
```

## API

- `createProactive({ analytics, memory, storage, fatigue, keys, identity, render, whenPaletteOpen, isPaletteOpen })`
- `await proactive.init()` — 開 storage、載入持久化的 variant stats
- `proactive.register(prompt)` / `proactive.unregister(id)`
- `await proactive.tick(ctx)` — 評估 trigger、fire 一個 prompt、回
  傳它的 id
- `await proactive.ask({ text, yesLabel, noLabel })` — 繞過 trigger,
  直接 render 一個 one-off prompt
- `proactive.pause()` / `proactive.resume()`
- `proactive.explain(id)` — 某個 prompt 的 last-shown / variant
  stats / 疲勞計數
- `await proactive.dispose()`

## 註冊 prompt

`PromptDefinition` 純粹是資料:

| 欄位 | 用途 |
|---|---|
| `id` | 唯一 key。用於疲勞 state 與 analytics。 |
| `category` | 選用分組(`onboarding`、`conversion` …)。讓 `dismissPenalty.sameCategory` 整組降溫。 |
| `priority` | 同一 tick 有多個符合時,分數高的贏。預設 0。 |
| `triggers` | `Trigger` 陣列。內建在下方。 |
| `triggerLogic` | `'AND'`(預設)或 `'OR'`。 |
| `surface` | 要顯示的東西:`text`、`yesLabel`、`noLabel`、`placement`、`autoTimeoutMs`、`dismissable`。 |
| `onResponse` | `(response, ctx) => void` — 你的 side effect(導頁、跑 skill 等)。 |
| `variants` | A/B variant。每個有自己的 `surface`。 |
| `variantSelector` | `'thompson_sampling'`(預設)、`'epsilon_greedy'`、`'random'`。 |

`text` 可以是字串、也可以是 `(ctx) => string`,所以可以把當前 page /
dwell 插進文案。

## 內建 trigger

從 `triggers` import(也以 `builtin.triggers` re-export):

| Trigger | 觸發條件 |
|---|---|
| `triggers.pageMatch({ path })` | `ctx.page` 符合字串(`includes`)或 `RegExp` |
| `triggers.dwell({ ms })` | `ctx.dwellMs >= ms` |
| `triggers.idleTime({ ms })` | `dwell` 的 alias(語意專用) |
| `triggers.scrollDepth({ percent })` | `ctx.scrollDepth >= percent` |
| `triggers.exitIntent()` | `ctx.customMeta.exitIntent` truthy |
| `triggers.schedule({ everyN })` | 每 N 次 tick |

自訂 trigger 一行就好 — 任何 `{ id, condition: (ctx) => boolean | Promise<boolean> }`:

```ts
const firstVisit: Trigger = {
  id: 'first_visit',
  condition: (ctx) => Boolean(ctx.customMeta?.firstVisit),
};
```

## Tick loop

Proactive 是被動的 — host 不 call `tick(ctx)` 就完全不動。你傳的
`ctx` 就是 `TriggerContext`:

```ts
proactive.tick({
  page: location.pathname,
  dwellMs: Date.now() - pageEnterAt,
  scrollDepth: pctScrolled(),
  customMeta: { firstVisit, abVariant: 'B' },
});
```

引擎每次 call 會依序:

1. 檢查疲勞(session cap、cooldown、連續 dismiss 上限)。
2. 檢查 palette 狀態(見下)。
3. 評估每個註冊 prompt 的 triggers。
4. 挑優先級最高的符合 prompt。
5. Call 你的 `render(prompt, surface)`,等回應。
6. 更新 variant stats、寫進 storage、fire `onResponse`。
7. 若 `analytics` 有 wire,track `proactive.shown` /
   `proactive.response`。

5 秒一次的 interval 通常已經夠 — tick 更密也沒用,cooldown gate 會
把實際 show 出來的頻率壓下去。

## Fatigue

```ts
fatigue: {
  maxPerSession: 3,         // 一個 page session 最多 fire 幾次
  cooldownMs: 60_000,       // 兩次 show 之間至少間隔
  consecutiveDismissCap: 3, // 連續 dismiss 幾次就停
  dismissPenalty: {
    sameId: 'session',      // 被 dismiss 的 prompt 整個 session 不再 fire
    sameCategory: 300_000,  // 同 category 整組冷卻 5 分鐘
  },
}
```

只要使用者回 `'yes'` 或 `'no'`,連續 dismiss 計數就歸 0。

## `render` 合約

`render` 是你唯一一定要接 UI 的部分 — proactive 不附預設 surface。
簽名:

```ts
type RenderFn = (
  prompt: PromptDefinition,
  surface: PromptSurface,
) => Promise<'yes' | 'no' | 'dismiss'>;
```

明確選擇 → resolve `'yes'` / `'no'`,使用者忽略 / 關閉 / 超時 →
resolve `'dismiss'`(會算進連續 dismiss cap)。

dddk-frontend 的 reference 把 prompt render 進 subtitle bar,讓
prompt 跟 voice / agent / selection 共用同一個中下方 surface:

```ts
import type { DotDotDuck } from '@perhapxin/dddk';
import type { PromptDefinition, PromptSurface } from '@perhapxin/dddk/modules/proactive';

export function createSubtitleProactiveRender(dddk: DotDotDuck) {
  return (_prompt: PromptDefinition, surface: PromptSurface) =>
    new Promise<'yes' | 'no' | 'dismiss'>((resolve) => {
      const text = typeof surface.text === 'function'
        ? surface.text({ now: Date.now() })
        : surface.text;
      dddk.subtitle.show({
        text: `${text}  ·  ${surface.yesLabel ?? '是'} / ${surface.noLabel ?? '否'}`,
        type: 'agent',
        onAccept: () => { dddk.subtitle.hide(); resolve('yes'); },
        onReject: () => { dddk.subtitle.hide(); resolve('no'); },
        onCancel: () => { dddk.subtitle.hide(); resolve('dismiss'); },
        autoHide: surface.autoTimeoutMs,
      });
    });
}
```

若要接 dddk 的 PieceSurface 系統,用內建的
`createPieceRender({ mount, locale })` helper。

## Palette 協調

當使用者已經開著 palette,通常不希望 proactive 插嘴搶注意力。把
`isPaletteOpen` 與 `whenPaletteOpen` 接上:

| 模式 | 行為 |
|---|---|
| `'suppress'`(預設)| Palette 開著時整個 tick 跳過 |
| `'subtitle_only'` | 只 fire renderer 能塞進 subtitle bar 的;非 Space 輸入視為「沒看到」 |
| `'blur_palette'` | 照 fire;host renderer 自行負責模糊背後的 palette |

dddk 暴露 `isPaletteOpen()`,加上(PanelSkill 提供的)
`isPanelOpen()` — 兩個合用,Panel 開著時也不會被打斷:

```ts
isPaletteOpen: () => paletteOpen || dddk.isPanelOpen?.() === true,
```

## A/B variant

給 `variants: [{ id, surface }, ...]`,引擎每次 fire 用 Thompson
sampling 從各 variant 的 yes/no 統計挑一個(stats 寫進 IndexedDB,
跨 reload 留著)。要更輕量的 bandit 用 `'epsilon_greedy'`,要均勻抽
用 `'random'`,不要 A/B 就不要傳 `variants`。

`proactive.explain(id)` 會回即時 variant stats — 做 debug panel 很
方便。

## 透過 webagent

Proactive **沒有**暴露成 LLM tool。Prompt 本來就是設計給
host-known signal(page、dwell、custom flag)用 — LLM 想說話直接
`dddk.subtitle.show()` 就好,不需要多一個 "show prompt" tool。

Proactive 發出的 event 看 [analytics](../analytics/overview.md)。
