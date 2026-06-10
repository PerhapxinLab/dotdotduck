# Dwell — 長按鎖定 DOM 元素

> 對任何可見元素長按約 700ms，一個選取框會吸附上去。被鎖住的元素就會成為「下一個」互動的 context — palette 開啟、語音提問、或 LLM 註解 popover。

Opt-in。預設關閉；要 attach 一個 `Dwell` instance 才有作用。互動形狀跟 iOS 的長按 context menu 一樣：按住不動，timer 到了 frame 才出現；如果在 timer 觸發前放開，正常的點擊 / 拖曳 / 文字選取就照常運作，像沒事發生過。

## 什麼時候用

Dwell 是「頁面上這個東西」的指針。適合：

- 使用者想針對某個元素**發問**（「這顆按鈕做什麼？」、「幫我摘要這段」）
- 某個 skill 需要頁面上任意區塊作為 context，但元素沒有寫死的 selector 可以指
- 給非技術使用者做一個「右鍵 → 檢查」的可觸控替代

不要用 Dwell：

- 使用者在可編輯欄位裡選取**文字** — 那是 [InlineAgent](./inline-agent.md) 的工作
- 你已經知道 selector，只是想 drive agent — 直接 call `dddk.startAgent()`
- 你用 Spotter（cursor-ring trigger，也會鎖元素）驅動 — 二選一，不然兩個會搶同一個手勢；看下面「跟 Spotter 衝突」一節

## Import

```ts
import { Dwell } from '@perhapxin/dddk';
import type { DwellConfig } from '@perhapxin/dddk';
```

## 最小設定 — 純選取手勢

預設模式**不**會 call LLM。frame 出現，你的 `onSelect` callback 被叫，元素被記住。後續操作（palette 開、語音 prompt）讀到這個 pinned 元素。

```ts
import { Dwell } from '@perhapxin/dddk';

let pinned: HTMLElement | null = null;

const dwell = new Dwell({
  // `llm` 是 optional — 只有 `annotateOnSelect: true` 才需要。
  dwellMs: 700,
  annotateOnSelect: false, // 預設 — 不 call LLM,只 pin
  onSelect: (el, selector) => {
    pinned = el;
    // 把元素的可見文字交給下一次 palette 開啟當 context。
    const text = (el.innerText ?? el.textContent ?? '').trim().slice(0, 240);
    dddk.palette.setPinnedContext(text, selector);
  },
  onClear: () => {
    pinned = null;
    dddk.palette.clearPinnedContext();
  },
});

dwell.attachTo(dddk);
```

## 配 LLM 註解 popover

設 `annotateOnSelect: true` 還原舊版「長按 → AI 註解」的 UX。frame 出現後，元素的可達 DOM 會送給 `inline` LLM role；回應會畫成一個緊湊 popover，貼在游標旁，內含 label 跟最多 3 個建議動作。

```ts
new Dwell({
  llm: yourLLM,
  dwellMs: 700,
  annotateOnSelect: true,
});
```

popover JSON 的 shape：

```json
{
  "label": "Refund button for order ORD-1002",
  "actions": ["Refund", "Copy order ID", "Open customer profile"]
}
```

要做 domain-specific label 就用 `systemPrompt: '...'` 覆蓋。

## 設定

| Option | Default | 說明 |
| --- | --- | --- |
| `llm` | — | `LLMSource`。`annotateOnSelect: true` 才需要。 |
| `dwellMs` | `700` | 觸發前要按住的時間。 |
| `annotateOnSelect` | `false` | pin 之後跑 LLM 註解 popover。 |
| `onSelect` | — | `(el, selector?) => void`。每次 pin 都會 fire。 |
| `onClear` | — | pinned 元素被清掉時 fire。 |
| `maxContextChars` | `800` | 送給 LLM 的 DOM 文字上限。 |
| `systemPrompt` | 內建 | 覆蓋註解 prompt。 |
| `enabled` | `true` | 一開始就啟用。之後可用 `setEnabled()` 切換。 |
| `ignoreSelector` | — | 額外的 selector，符合的元素永遠不觸發。 |
| `ignoreDefaults` | `false` | 跳過內建的 ignore 清單（input、textarea、contenteditable 等等）。 |
| `triggerModifier` | `null` | 需要按住 `'alt' \| 'shift' \| 'meta' \| 'ctrl'`。 |
| `enableOnTouch` | `false` | 在 touch 裝置上跑長按偵測（會跟 OS 長按衝突）。 |

## 取消語意 — frame 會留著

frame 代表的是**選取狀態**，不是 hover preview。pin 之後，**只有**這幾種方式能清掉：

- `Esc` 鍵
- mousedown 點到被選元素 / popover 之外
- popover 自己的關閉按鈕
- `dwell.setEnabled(false)` 或 `dwell.destroy()`

**不會**清掉的事情（這是刻意的，為了壓掉一個一直 regress 的 bug）：

- 滑鼠移動
- LLM 註解 call 失敗 / timeout
- 新的 agent 任務開始

要程式化清掉，最直接：

```ts
dwell.setEnabled(false);
dwell.setEnabled(true);
```

## Opt-out selector 清單

預設 ignore 清單：

```
[data-no-dwell], input, textarea, select,
[contenteditable], [contenteditable="true"], [draggable="true"]
```

`data-no-dwell` 永遠優先。要加額外規則但不動預設：

```ts
new Dwell({
  ignoreSelector: '.acme-hold-to-confirm, .acme-pricing-card',
});
```

要完全取代預設（少用）：

```ts
new Dwell({
  ignoreSelector: '.only-this-ignored',
  ignoreDefaults: true,
});
```

## 要求 modifier

如果站台本身就用普通長按，可以加 modifier 來區隔：

```ts
new Dwell({ triggerModifier: 'alt' });  // 只接受 Alt + 長按
```

## Runtime API

```ts
dwell.markedElement();   // 目前 pin 的元素，沒有就 null
dwell.setEnabled(false); // 關掉但不 unmount
dwell.setEnabled(true);  // 再開
dwell.isEnabled();       // boolean
dwell.destroy();         // 完全 unmount listener 跟 popover
```

## Cookbook：Dwell 長按 → 多選 picker

這是 Dwell 的旗艦互動模式。Flow：

1. 使用者長按某個元素。Dwell 把 frame 釘上去，把元素 signature 餵給 `palette.setPinnedContext`，下次開 palette 就會看到這個 context。
2. pin 完馬上開一個 [`subtitle.showChoice`](./subtitle.md#%E5%A4%9A%E9%81%B8-picker-showchoice) picker，問使用者要對選取做什麼 — 通常是 3 個最常見的問法外加一個 `Other (輸入)` free-text fallback。
3. 使用者挑（`1`/`2`/`3`、點擊、或在 Other 列打字）。Host 把選到的東西轉成任務字串，呼叫 `dddk.startAgent(task, { selection: { text, elements } })`。

```ts
const dwell = new Dwell({
  dwellMs: 500,
  annotateOnSelect: false,
  onSelect: (el, selector) => {
    pinned = el;

    // 把 pinned 元素的 signature 餵給 palette 當 context。
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList.length
      ? '.' + Array.from(el.classList).slice(0, 3).join('.')
      : '';
    const sig = `<${tag}${id}${cls}>`;
    const inner = (el.innerText ?? el.textContent ?? '').trim().slice(0, 200);
    const ctx = inner ? `${sig} ${inner}` : sig;
    dddk.palette.setPinnedContext(ctx, selector, { kind: 'dom' });

    // pin 完馬上開多選 picker — 使用者剛剛說了「我在乎這個東西」,
    // 就把最常見的 3 種問法（解說 / 摘要 / 翻譯）擺出來,加一個
    // Other free-text 列。選好之後 webagent 立刻以這個元素當
    // SelectionContext 跑。
    dddk.subtitle.showChoice({
      question: '要對這個部分做什麼?',
      options: [
        '解說這個部分',
        '摘要重點',
        '翻譯成英文',
        '其他 (輸入問題)',
      ],
      allowFreeText: true,
      autoHide: 8000,
      onChoose: (value, index) => {
        const task =
          index === 0 ? '請用淺白的話解說使用者選到的這個元素是什麼、做什麼用。'
          : index === 1 ? '請摘要使用者選到的這段內容的重點。'
          : index === 2 ? '請把使用者選到的這段內容翻譯成英文,保留原意與語氣。'
          : value; // free-text:使用者打什麼就 pass through
        dddk.startAgent(task, {
          selection: { text: ctx, elements: [selector] },
        });
      },
      // onCancel 故意不寫 — Esc 只關 picker,留著 pin frame,
      // 從 frame 觸發的 palette / voice 還能正常拿到 context。
    });
  },
  onClear: () => {
    pinned = null;
    dddk.palette.clearPinnedContext();
  },
});
```

### 為什麼要這樣做

舊版的 dddk host 走時間觸發的 proactive（「使用者在 `/commercial` 已 dwell 30 秒 — 跳一個 Yes/No 問是否要 X」）。對使用者刻意手勢的直接回應永遠贏過時間觸發的打斷：使用者剛跟你說了在乎哪個元素，picker 該出現的時間點就是現在，不是 30 秒後。

### 行為細節

- `autoHide: 8000` — picker 8 秒沒互動自己消失，誤觸的長按不會卡在畫面上。
- `Esc` 只關 picker，Dwell 的 pin 還**留著**。pin frame 是選取狀態（見上面 [取消語意](#%E5%8F%96%E6%B6%88%E8%AA%9E%E6%84%8F-frame-%E6%9C%83%E7%95%99%E8%91%97)），picker 關掉後從 frame 觸發的 palette / voice 還是看得到 context。要連 pin 一起清，走正常 Dwell 清除手勢（再按一次 Esc 在沒 picker 的狀態、mousedown 點到外面等等）。
- `index === -1`（free-text）的字直接 pass through 當任務字串。沒有特殊「Other」sentinel — host 用 index 判斷，然後把打的字當 agent prompt。

### 你不想要這個的話

要 Dwell 只當純 pin 手勢、不接後續問題（例如 workflow 只用 palette 開），就在 `onSelect` 裡別 call `showChoice` 就好。Dwell 還是會 pin frame 跟設 palette 的 pinned context，後面沒任何後續動作，等使用者自己決定下一步。

## 把 Dwell 接到語音 prompt

pin 上一個元素後，你的 `voice_start` handler 在 call `dddk.startAgent` 之前要把元素的可見文字塞到 prompt 前面：

```ts
dddk.on('voice_start', () => {
  voice.captureOnce(dddk.subtitle).then((text) => {
    if (!text) return;
    if (pinned) {
      const ctx = (pinned.innerText ?? '').trim().slice(0, 600);
      dddk.startAgent(
        `User is asking about this on-page region:\n"""\n${ctx}\n"""\n\nQuestion: ${text}`,
      );
    } else {
      dddk.startAgent(text);
    }
  });
});
```

完整 voice pipeline 看 [voice.md](./voice.md)。

## 跟 Spotter 衝突

Spotter（cursor-ring trigger，看 [../triggers/spotter.md](../triggers/spotter.md)）也會 pin 元素 — 改用 cursor ring hover 而不是長按。兩個東西用不同 ergonomics 解同一件事：

- **Spotter** — 鍵盤 / 指標精準；桌面 power user 喜歡
- **Dwell** — 好發現，對卡片 / 段落這種沒有 cursor ring 的場景管用

挑一個當主要。兩個同時跑技術上可以，但同一個元素會被 pin 兩次（兩邊各一次），`palette.setPinnedContext` 會被後 fire 的那個覆蓋。如果一定要兩個都開，記得兩邊的 `onSelect` 要 idempotent，而且共用同一個 `pinned` 變數。

## Touch 行為

`enableOnTouch` 預設 `false`。iOS / Android 的 OS 本身就用長按做文字選取 / context menu，手機使用者通常透過 [MobileTrigger](./mobile-trigger.md) chrome 操作。只有 touch-only kiosk 那種「OS 長按可以蓋掉」的場景才開 `enableOnTouch: true`。

## 主題化

選取 frame 是 host 自己 style 的 `[data-dddk-dwell-target]` 屬性。CSS 變數客製（看 [../theming.md](../theming.md)）：

```css
:root {
  --dddk-dwell-frame-color: var(--dddk-accent, #ec4899);
  --dddk-dwell-frame-width: 2px;
  --dddk-dwell-frame-offset: 4px;
  --dddk-dwell-frame-radius: 6px;
}
```

註解 popover（`annotateOnSelect: true` 時）有自己 scoped 的 styles；覆蓋用 `[data-dddk-ui="dwell"]` 屬性選擇器。

## Tear-down

```ts
dwell.destroy();
```

移除 listener、popover、跟選取 frame 屬性。SPA route 切換 / unmount 一定要呼叫，不然下次 `attachTo()` 會 double-bind。

也看：[./overview.md](./overview.md) 完整模組索引。
