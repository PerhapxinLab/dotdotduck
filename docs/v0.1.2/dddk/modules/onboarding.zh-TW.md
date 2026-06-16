# OnboardingModule — 首次造訪自動跑導覽

> 把一個普通的 `ScriptSkill` 包上「看過」持久化旗標、可選的 URL 路徑 gating、跟一個「重看導覽」的 palette 指令。使用者第一次進到符合條件的頁面時導覽會自動跑；之後沒 reset 就不會再跑。

Opt-in。Module 本身只是 skill 的薄 lifecycle wrapper — 沒有自己的 DOM。

## 什麼時候用

- 引導式導覽，告訴使用者 dddk 的 Ctrl+K、語音手勢、dock 在哪
- 單一功能的首次說明（「你開啟了 InlineAgent — 這是它的用法」）
- 鎖在某個 URL 的新版本 "what's changed" 彈窗

不要用：

- 導覽需要**每次** session 都跑（例如定期訓練提醒）— 改用一般 palette 指令
- 導覽要依使用者帳號狀態分支 — 寫一個 `PanelSkill`，自己 conditional run
- 「first-time」要的不是導覽而是一則 toast — 在 bootstrap 直接 `dddk.subtitle.show()`

## Import

```ts
import { OnboardingModule } from '@perhapxin/dddk';
import type { OnboardingConfig } from '@perhapxin/dddk';
```

## 最小設定

```ts
import { OnboardingModule, type ScriptSkill } from '@perhapxin/dddk';

// 1. 把導覽定義成一般 ScriptSkill
const tour: ScriptSkill = {
  id: 'first-time-tour',
  name: '快速導覽',
  kind: 'script',
  steps: [
    { kind: 'subtitle', text: '歡迎！按 Ctrl+K 隨時叫出指令面板。', autoHide: 4000 },
    { kind: 'subtitle', text: '長按空白鍵可以對 dddk 講話。', autoHide: 4000 },
    { kind: 'subtitle', text: '長按頁面上任何元素 → 它會被鎖定成下個操作的 context。', autoHide: 4000 },
  ],
};

// 2. 跟平常一樣註冊到 skill registry
dddk.skills.register(tour);

// 3. 用 OnboardingModule 包起來
const onboarding = new OnboardingModule({
  skill: tour,
  storage: localStorageAdapter,         // 你的 StorageAdapter
  runOnPath: ['/', '/dashboard'],       // 只在這些路徑自動跑
  startDelayMs: 800,                    // 等 host render 完
});

// 4. dddk.mount() 之後讓它決定要不要跑
dddk.mount();
onboarding.maybeRun((id) => dddk.skills.run(id));

// 5. 加 palette 指令讓使用者可以重看
onboarding.registerOn(dddk.palette, (id) => dddk.skills.run(id));
```

## 設定

| Option | Default | 說明 |
| --- | --- | --- |
| `skill` | — | 要跑的 `ScriptSkill`。必填。 |
| `storage` | — | 「看過」旗標用的 `StorageAdapter`。必填。 |
| `storageKey` | `dddk.onboarding.seen.<skill.id>` | 旗標存哪個 key。 |
| `runOnPath` | 任何頁 | `string \| RegExp \| Array<string \| RegExp>` — 用 `location.pathname` gate。 |
| `startDelayMs` | `500` | `maybeRun()` 之後等多久才開始 skill。 |

## Runtime API

```ts
onboarding.maybeRun(runSkill);  // 沒看過 + 路徑符合就跑
onboarding.markSeen();          // 標記看過但不跑（例如使用者手動完成後）
onboarding.reset();              // 忘掉旗標，下次造訪會再跑
onboarding.hasSeen();            // boolean
onboarding.paletteCommands(run); // 回傳 PaletteItem[] 供手動 register
onboarding.registerOn(palette, run); // shortcut: 直接把指令掛上 palette
```

自動註冊的 palette 指令是「重看導覽」— 點下去會 reset 看過旗標，立刻重跑導覽。

## URL gating

`runOnPath` 接受字串跟 regex 混用：

```ts
new OnboardingModule({
  skill: tour,
  storage,
  runOnPath: [
    '/',
    /^\/projects\/[^/]+$/,    // 任何單一專案頁
    /^\/onboarding/,           // /onboarding 下所有頁
  ],
});
```

字串**完全相等**比對；regex 用 `.test()`。每次 `maybeRun()` 都會檢查，所以 route 變更後重新 call 會重新評估。

## Storage shape

```ts
interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
```

任何符合的 KV 都能用。預設 key 用 skill id 加 namespace，多個 onboarding module 不會撞。要做跨版本失效就改 `storageKey`（例如 `dddk.onboarding.seen.v2.tour`）。

## 「完成」的兩種方式

自動跑的路徑會在 skill resolve 之後 call `markSeen()` — 所以 skill throw 不會被標記成看過，使用者下次還有一次機會。如果你的 skill 要在部分完成時就標記（例如使用者中途 dismiss），在 skill 的 step handler 裡自己 call `markSeen()`。

## Tear-down

沒東西要清 — `OnboardingModule` 沒有 listener 或 DOM。Palette 指令會一直在，除非你 call `palette.removeItem(id)` 或 destroy palette。

也看：[../skills/how-to-add-a-skill.md](../skills/how-to-add-a-skill.md) 底層的 `ScriptSkill` shape；[./overview.md](./overview.md) module 索引。
