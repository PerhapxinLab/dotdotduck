# AgentCursor — 看得見的游標 + 點擊前停頓

> 一個放大的浮動游標，會移動到 webagent 即將點擊 / 輸入 / 捲動的元素上。到達後會停頓一下，使用者才看得到「下一步要發生什麼」，也有時間取消。

Opt-in。預設關掉；attach 一個 `AgentCursor` instance 才會啟用。

## 什麼時候用

- Demo / onboarding 流程，需要讓使用者**看到** agent 在做什麼
- 敏感流程（刪除、購買、不可逆寫入），點擊前的視覺停頓是一層 soft safety net
- 錄 dddk 操作影片 — 游標 + flash overlay 在影片上看得清楚

不要用：

- agent 在做純後台工作（抓資料、分類、生摘要）— 沒東西可以指
- 你需要的是 hard confirmation gate，不只是視覺提示 — 改用 subtitle 的 `onAccept` / `onReject`
- 使用者已經在看 live screen-share — 真實游標就看得到了，重複會吵

## Import

```ts
import { AgentCursor } from '@perhapxin/dddk';
import type { AgentCursorConfig } from '@perhapxin/dddk';
```

## 最小設定

```ts
import { AgentCursor } from '@perhapxin/dddk';

const cursor = new AgentCursor({
  preClickPauseMs: 250, // 每個動作觸發前的停頓時間
  size: 32,
  travelMs: 350,
});
cursor.attachTo(dddk);
```

一般用法的 API 表面就這樣。Module 會自動訂閱 agent 的 `before_action`、`step`、`done`、`error`，並在每個 `agent_start` 重新接線，所以新的 agent session 不需要重 attach。

## 怎麼運作

這是純粹的視覺化層 — **不**驅動動作。流程：

1. webagent emit `before_action`，payload 是 `{ actionName, params, targetSelector? }`
2. AgentCursor query selector，算出中心，用 `travelMs` 把游標動畫過去
3. 目標元素短時間（預設 600ms）會被加上 `[data-dddk-agent-target]` 屬性，讓 host CSS flash
4. AgentCursor await `preClickPauseMs` 之後才讓 `before_action` resolve
5. webagent 跑動作；AgentCursor 在游標上放出「點擊環」動畫
6. `done` / `error` 時游標 fade out

沒有 DOM 目標的動作（`wait`、`done` 等等）會讓游標留在原地。

## 設定

| Option | Default | 說明 |
| --- | --- | --- |
| `preClickPauseMs` | `250` | 游標到達目標後到動作觸發之間的停頓。 |
| `size` | `32` | 游標尺寸（px）。 |
| `color` | `var(--dddk-accent, #ec4899)` | 游標 stroke 顏色。 |
| `travelMs` | `350` | 在不同目標之間移動的時間。 |
| `enabled` | `true` | 啟動時就開。之後可用 `setEnabled()` 切換。 |

## Runtime API

```ts
cursor.setEnabled(false); // 隱藏 + 跳過 pre-click pause
cursor.setEnabled(true);
cursor.destroy();         // unmount listener + DOM node
```

關掉時 `before_action` 立刻 return，游標保持隱藏。再開時下個動作恢復。

## 目標 flash 的 CSS

目標元素上短暫的 outline，host 可以自己 style：

```css
[data-dddk-agent-target] {
  outline: 2px dashed var(--dddk-accent, #ec4899);
  outline-offset: 2px;
  transition: outline-color 0.2s;
}
```

要 per-element 覆蓋就寫一條 specificity 更高、或在更後層的 rule。

## 跟其他 module 的互動

- **[Dwell](./dwell.md)** — 互不干擾。如果 agent 對 pin 起來的元素做動作，游標會移過去；dwell frame 還是維持「這是使用者目前的選取」的語意。
- **[InlineAgent](./inline-agent.md)** — InlineAgent 不會 fire webagent 動作，所以 inline 編輯時游標不會動。改用 subtitle 的 `processing` indicator。
- **[MobileTrigger](./mobile-trigger.md)** — 可以用，但游標概念是 desktop-shaped 的。touch 上建議關掉 AgentCursor，靠 subtitle 旁白就好。

## Edge case — 連續動作

如果第一次 `preClickPauseMs` 還沒到第二個 `before_action` 就 fire 了，前一個 pause 會立刻 resolve，避免 agent loop 卡住。游標跳到新目標，重新開始 pause。

## Tear-down

```ts
cursor.destroy();
```

移除游標元素，detach 所有掛在當前 agent 上的 listener。

也看：[./subtitle.md](./subtitle.md) 旁白游標在做的事；[./overview.md](./overview.md) module 索引。
