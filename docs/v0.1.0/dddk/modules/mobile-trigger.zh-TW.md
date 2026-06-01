# MobileTrigger — FAB + 手勢的觸控進入點

> 兩種行動裝置進入點：永遠看得到的浮動操作按鈕（FAB）、跟快速上下滑動手勢（滑出上下兩條 chrome bar）。點中央語音按鈕、開 palette、或關掉回到頁面。

Opt-in。只在行動裝置上有作用 — 寬桌面 viewport 是 no-op，除非 `forceEnable: true`。

## 什麼時候用

- 任何要出貨到手機 / 平板的 production app
- 用戶會用手機看的 demo 頁 — 沒有實體鍵盤，FAB 是唯一明顯的進入點
- Kiosk / 平板，用戶不會想到長按或按 Ctrl+K

不要用：

- App 只給桌面用，且 `viewport` 已停用 mobile rendering
- 你已經有自家 FAB / nav trigger — 用下面的 `bindTrigger` 把它接進 dddk

## Import

```ts
import { MobileTrigger } from '@perhapxin/dddk';
import type { MobileTriggerConfig, MobileFABConfig } from '@perhapxin/dddk';
```

## 最小設定

```ts
import { MobileTrigger } from '@perhapxin/dddk';

const mobile = new MobileTrigger();
mobile.attachTo(dddk);
```

預設 FAB 出現在右下，icon 是 sparkle SVG。點一下開 palette；長按 fire `voice_start`（跟桌面的 Space 手勢一樣）。

## 三種觸發方式

### 1. 預設 FAB

在 touch 裝置或窄 viewport（`max-width: 768px`）上永遠看得到。完全可客製：

```ts
new MobileTrigger({
  fab: {
    icon: '✨',           // emoji、raw HTML/SVG、或 HTMLElement
    text: 'Ask',          // 可選的 icon 旁邊文字
    position: 'bottom-left',
    offset: { x: 16, y: 80 },
    size: 60,
    shape: 'pill',        // 'circle' | 'square' | 'pill'
    style: { background: 'linear-gradient(45deg, #ec4899, #8b5cf6)' },
    onTap: (dddk) => dddk.palette.toggle(),
    onLongPress: (dddk) => dddk.triggerVoiceStart(),
  },
});
```

關掉預設 FAB：

```ts
new MobileTrigger({ fab: false });
```

### 2. 綁自家 trigger

你的 app 已經有 header / nav 按鈕，要給它跟 FAB 一樣的手勢處理：

```ts
const off = mobile.bindTrigger(document.querySelector('#my-header-btn')!, {
  onTap: (dddk) => dddk.palette.toggle(),
  onLongPress: (dddk) => dddk.triggerVoiceStart(),
});
// later: off();
```

搭配 `fab: false` 讓 dddk 不要再 render 一個浮動按鈕。

### 3. 上下滑手勢 — 上下 chrome bar

快速上下手指搖動（預設 700ms 內 ≥3 次方向反轉）會滑出兩條半透明 chrome bar：

```
┌──────────────────────────────────────────┐
│ 🔍 Palette                            ✕ │  ← top bar
├──────────────────────────────────────────┤
│                                          │
│   (原始頁面內容 — 還是可以捲；點任何     │
│    元素會走 dwell-style，而不是該元素    │
│    自己的 click)                          │
│                                          │
├──────────────────────────────────────────┤
│              ●  (中央按鈕)                │  ← bottom bar
└──────────────────────────────────────────┘
```

為什麼用這個手勢：一般滾頁只會一個方向 → 沒有 false positive。不會撞到 iOS back、Android nav、pull-to-refresh。

**中央按鈕**（取代桌面 Space）：

| 手勢 | Event |
| --- | --- |
| 單擊 | `dddk:mobile-accept` |
| 雙擊（< 350ms） | `dddk:mobile-reject` |
| 長按（> 200ms） | `dddk:mobile-voice-start`、放開時 `dddk:mobile-voice-end` |

Host 在 `document` 上聽這些 event，串到桌面 Space 用的同樣 handler。

## 設定

| Option | Default | 說明 |
| --- | --- | --- |
| `reversalsToTrigger` | `2` | 觸發 chrome 所需的最少方向反轉次數。 |
| `swipeWindowMs` | `900` | 反轉必須發生在這個時間窗（ms）內。 |
| `minSwipeDelta` | `18` | 每次反轉的最小 Y delta（px）。濾掉抖動。 |
| `longPressMs` | `200` | 語音的長按門檻。 |
| `doubleTapMs` | `350` | 雙擊判定的時間窗。 |
| `forceEnable` | `false` | 在非 touch 裝置上跑（DevTools 測試）。 |
| `dwellOnTap` | `false` | chrome 開著時，點頁面元素會 fire palette，且帶上被點元素當 context。 |
| `fab` | `{}` | `MobileFABConfig \| false`。客製或停用預設 FAB。 |

### FAB 設定（`MobileFABConfig`）

| Option | Default | 說明 |
| --- | --- | --- |
| `enabled` | `true` | 顯示 FAB。 |
| `icon` | sparkle SVG | emoji、raw HTML、或 `HTMLElement`。 |
| `text` | — | icon 旁邊的可選文字。 |
| `ariaLabel` | `'Open command palette'` | ARIA label。 |
| `position` | `'bottom-right'` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'`。 |
| `offset` | `{ x: 20, y: 24 }` | 邊緣 pixel offset。 |
| `size` | `56` | 直徑（`pill` 是高度）。 |
| `shape` | `'circle'` | `'circle' \| 'square' \| 'pill'`。 |
| `style` | — | Inline CSS override，最後套用。 |
| `className` | — | 額外 className，給 host CSS 鎖定。 |
| `onTap` | 開 palette | `(dddk) => void`。 |
| `onLongPress` | 語音 start | `(dddk) => void \| null`。傳 `null` 停用。 |

## Runtime API

```ts
mobile.show();              // 滑入 chrome bar
mobile.hide();              // 滑出
mobile.toggle();            // 切換 chrome
mobile.setDwellOnTap(true); // chrome 開著時，把頁面 tap 路由給 Dwell
mobile.isDwellOnTap();      // boolean
mobile.setFabVisible(false); // 隱藏 / 顯示預設 FAB
mobile.getFabElement();     // mount 過的 <button>
mobile.destroy();           // 移除 FAB + chrome + listener
```

## Viewport 偵測

Module 用 `matchMedia('(max-width: 768px)')` 即時反應 viewport 變化。轉螢幕方向或視窗 resize 跨越 breakpoint 時 FAB 會自動 mount / unmount。Swipe detector 只在真實 touch 裝置（`'ontouchstart' in window`）上綁，滑鼠拖曳永遠不會誤觸。

寬桌面 viewport 上 FAB 會被 CSS `@media` 規則藏起來，即使 `attachTo()` 已經 mount 它（這在桌面跟手機共用一個 bundle 時很重要）。

## Tear-down

```ts
mobile.destroy();
```

移除 FAB、兩條 chrome bar、所有 event listener、跟 viewport media-query listener。

## Touch 手勢的 orchestrator API

桌面上 Space 接的是完整 gesture pipeline — 給 script skill 用的 accept event、分析用的 intent emission、字幕條 invoke。Touch 裝置沒 Space，所以 SDK 把同一條 pipeline 開放成兩個 orchestrator 的 public method，FAB tap / 自訂按鈕直接 call：

```ts
dddk.triggerAccept();   // 等同單擊 Space
dddk.triggerReject();   // 等同雙擊 Space
```

兩個都會：
- 發 `gesture_accept` / `gesture_reject` event（script skill runner 等的就是這個），
- 呼叫 `subtitle.invokeAccept()` / `invokeReject()`（推進 pause、接受 confirm、關閉 info bar），
- 發一個 `intent` event with `kind: 'agent_answered'`（分析端會記到）。

推薦的 `MobileFABConfig.onTap` 就是下面這個雙模式 pattern — 有需要 accept 的就 accept，閒著就開 palette：

```ts
new MobileTrigger({
  fab: {
    onTap: (dddk) => {
      if (dddk.subtitle.isVisible()) {
        dddk.triggerAccept();   // 任務進行中：繼續
      } else {
        dddk.palette.toggle();  // idle：開 palette
      }
    },
  },
});
```

`triggerReject()` 對稱使用 — 接到 cancel 手勢上（自家按鈕的雙擊、按住放開等）。

字幕條本體的單擊 / 雙擊路由是內建的：touch 裝置上 bar 監聽 `pointerup`，dispatch `dddk:bar-tap-accept` / `dddk:bar-tap-reject` DOM event，orchestrator 接到後走同一條 pipeline。Host 不用寫 — 即使沒 FAB，user 點一下字幕條 script skill 也會推進到下一步。

也看：[./voice.md](./voice.md) 中央按鈕 + FAB 長按會 fire 的語音 event；[./overview.md](./overview.md) module 索引。
