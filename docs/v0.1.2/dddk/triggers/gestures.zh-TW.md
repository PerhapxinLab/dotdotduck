# Gestures

`GestureManager` 把鍵盤事件翻成 dddk 的環境手勢：accept / reject / voice / palette toggle / escape。它在 `document` 的 capture phase 監聽 — 所以瀏覽器內建的 Ctrl+K、space-scroll 之類的快捷鍵會被先攔下來。

幾乎不會自己 `new` — `DotDotDuck.mount()` 會建一個並接好 `palette`、`subtitle`、webagent。你只透過 `DotDotDuckConfig` 調它：

```ts
import { DotDotDuck } from '@perhapxin/dddk';

new DotDotDuck({
  gestureKey: 'space',        // 或 'ctrl'（舊版遷移）。預設 'space'。
  voice: { enabled: true },   // false 關掉長按錄音
}).mount();
```

要更細的控制（自訂 `shouldIntercept`、非預設的 hold threshold）才自己 `new GestureManager` — 它有 export。

---

## 手勢表

| 輸入                          | Fire                          | 何時                                                              |
| ----------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| 單擊 space（<200ms）          | `onAccept`                    | 只有有東西「待回應」的時候（subtitle 顯示中 / palette 開著）。  |
| 雙擊 space（<350ms）          | `onReject`                    | 永遠。取消最近的 pending UI。                                    |
| 長按 space（≥200ms）          | `onVoiceStart` → `onVoiceEnd` | 開始錄音；鬆手結束。                                              |
| `Tab`（有 suggestion 時）      | `onAcceptLine`                | 接受 streaming subtitle 的下一行。                               |
| `Escape`                      | `onEscape`                    | 永遠。把 palette / subtitle / spotter lock 都關掉。              |
| `Ctrl+K` / `Cmd+K`            | `onPaletteToggle(selection)`  | 永遠。當下抓到的選取文字會一起帶進去。                            |
| `Ctrl+Space` 在 input 裡面    | `onAccept`                    | 一邊打字一邊 accept，不會干擾 input 內容。                       |

幾個眉角：

- **Input 裡的 space** — keydown 會被 `preventDefault`。鬆手在 threshold 前面，dddk 會在游標位置插一個 literal space；超過 threshold 才開錄音、不會插 space。正常打字照常運作，長按一樣能錄音。
- **`hasSuggestion`** — orchestrator 在 subtitle bar 顯示的時候會 flip 這個 flag。單擊只在 `hasSuggestion === true` 才 fire `onAccept`，不然會被吞掉（不小心按到空白也不會發生怪事）。
- **Voice 開關** — `voice: { enabled: false }` 上游就會把 `onVoiceStart` / `onVoiceEnd` 變 no-op。長按還是會偵測（不然 palette 會跟同一次長按搶事件），但不會 fire `voice_start`。

---

## `GestureManagerOptions`

| field              | type                                | 預設                  | 做什麼                                                         |
| ------------------ | ----------------------------------- | --------------------- | ------------------------------------------------------------- |
| `callbacks`        | `GestureCallbacks`                  | —                     | 七個 handler（上面那張表）。                                   |
| `shouldIntercept`  | `() => boolean`                     | `() => hasSuggestion` | 每次 space keydown 都呼叫一次，回 true 才由 dddk 接管。       |
| `gestureKey`       | `'space' \| 'ctrl'`                 | `'space'`             | 哪個鍵代表「手勢」。舊版 UI 用 `'ctrl'`。                     |
| `holdThresholdMs`  | `number`                            | `200`                 | 開錄音的 hold 門檻。越短越靈敏但越容易 mis-fire。              |

### `GestureCallbacks`

```ts
interface GestureCallbacks {
  onAccept: () => void;
  onReject: () => void;
  onAcceptLine: () => void;
  onVoiceStart: (selection: string, images: string[]) => void;
  onVoiceEnd: () => void;
  onPaletteToggle: (selection: string) => void;
  onEscape: () => void;
}
```

`onVoiceStart` 拿到的是按下去的瞬間就先抓好的 selection（使用者當時 highlight 的文字）跟那段裡面的 `<img src>` — 跟 palette chip-bar 同一個 pattern。

---

## 調 `holdThresholdMs`

預設 200ms 是內部測試後體感最自然的設定。

- **更短（150ms）** — 錄音反應像瞬發，但使用者按鍵猶豫一下就會誤觸。只適合 power user 才會碰的功能。
- **更長（300–400ms）** — 幾乎不誤觸，但錄音延遲明顯；使用者會以為按鍵壞了。除非你有資料顯示使用者在抱怨，不然不要往上拉。

這是 global setting，沒有 per-context 的版本。要看狀況分歧的話放在 `shouldIntercept` 裡。

---

## `shouldIntercept`

預設只在**有東西 pending**（subtitle 顯示 / palette 開）的時候才把 space 吃掉。一般頁面 space 照常 scroll。

最常見的覆寫理由是：在某些 input 裡面連 Ctrl+Space 都不該觸發手勢：

```ts
import { GestureManager } from '@perhapxin/dddk';

const gestures = new GestureManager({
  callbacks: { ... },
  shouldIntercept: () => {
    // 使用者在 code editor 裡面就不要攔。
    if (document.activeElement?.closest('.monaco-editor')) return false;
    return dddk.subtitle.isVisible() || dddk.palette.isOpen();
  },
});
gestures.start();
```

dddk 的 input-space 特殊處理（keydown preventDefault、鬆手插 space、長按錄音）只有在 `shouldIntercept()` 對那一次 keystroke 回 `true` 才會走。回 `false` 整個按鍵就跟平常一樣。

---

## 什麼時候要自己 `new` 一個

99% 的 host 讓 `DotDotDuck` 自己建 `GestureManager`。下面幾種情況才會自己建：

- dddk 嵌在一個已經吃住整個鍵盤的 app 裡面（例如有 Vim binding 的 IDE），需要兩邊共用 `GestureManager`。
- 寫測試 harness，需要 synthetic 觸發 `onVoiceStart`。
- 完全自幹 palette / subtitle 那層，不走 dddk 的接線。

接線範例：

```ts
import { GestureManager } from '@perhapxin/dddk';

const gestures = new GestureManager({
  callbacks: {
    onAccept:        () => yourAcceptHandler(),
    onReject:        () => yourRejectHandler(),
    onAcceptLine:    () => yourAcceptHandler(),
    onVoiceStart:    (sel, imgs) => yourVoiceStart(sel, imgs),
    onVoiceEnd:      () => yourVoiceEnd(),
    onPaletteToggle: (sel) => yourPalette.toggle(sel),
    onEscape:        () => yourDismiss(),
  },
  shouldIntercept: () => isAnyDddkUIVisible(),
  holdThresholdMs: 200,
});
gestures.start();

// 之後 — 有 suggestion 出現 / 消失
gestures.hasSuggestion = true;
gestures.hasSuggestion = false;

// teardown
gestures.destroy();
```

---

## 相關

- [palette](./palette.md) — `Ctrl+K` 走的就是 `onPaletteToggle`。
- [spotter](./spotter.md) — hover 一個元素的同時長按，Spotter（如果有 start）會接過去進 lock mode。
- [subtitle](../modules/subtitle.md) — `onAccept` / `onReject` 會幫你 fire subtitle 上面的 accept/reject callback。
