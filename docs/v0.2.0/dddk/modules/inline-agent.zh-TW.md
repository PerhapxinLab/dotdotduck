# InlineAgent — 可編輯欄位內的選取選單

> 選取文字後浮出的選單，預設在反白下方。在 `<input>`、`<textarea>` 或 `[contenteditable]` 裡選文字就會跳出來。挑一個動作，選取的範圍就會被 LLM 的改寫結果取代。

Opt-in。預設關掉；要 attach 一個 `InlineAgent` instance 才會啟用。

## 什麼時候用

- 改寫 / 翻譯 / 縮短 / 修正使用者**正在編輯的**文字
- domain-specific 的轉換，且要直接落回 form field（例如「把這封 email 改成客服語氣」）

不要用：

- 選取的是頁面上**非編輯區**的文字 — 那是 palette 的工作（`palette.context.selectionText`），不是這個 module
- 你想讓 LLM 產出讓使用者**讀**的自由文 — 改用 [Subtitle](./subtitle.md) + agent task
- 你想跨多個欄位做連續編輯 — 用 [skill](../skills/overview.md)，這樣使用者看到的是一個進度 UI，不是七個 popover

## Import

```ts
import { InlineAgent } from '@perhapxin/dddk';
import type { InlineAgentConfig, InlineAction } from '@perhapxin/dddk';
```

## 最小設定

```ts
import { InlineAgent } from '@perhapxin/dddk';

const inline = new InlineAgent({
  llm,
  locale: 'zh-TW', // 內建 i18n: 'en' | 'zh-TW'
});
inline.attachTo(dddk);
```

這樣就夠了。在可編輯元素裡 ≥ 2 個字元的選取就會跳出選單。

## 內建動作

預設出貨七個：

| `id` | English label | 中文 label |
| --- | --- | --- |
| `translate` | Translate | 翻譯 |
| `improve` | Improve writing | 改寫 |
| `fix` | Fix spelling & grammar | 修文法 |
| `shorter` | Make shorter | 縮短 |
| `longer` | Make longer | 延長 |
| `tone` | Change to professional tone | 改成正式語氣 |
| `explain` | Explain this | 解釋 |

Translate 是**動態**動作 — 點下去會開語言子選單。用 `translateTargets` 覆蓋語言：

```ts
new InlineAgent({
  llm,
  translateTargets: [
    { code: 'en', label: 'English' },
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'ja', label: '日本語' },
  ],
});
```

## 一次 call 的組裝方式

InlineAgent **不**是把選取片段直接丟給 LLM。它會拼一個**context window**（選取前後各約 400 字元），用 `[[SEL]]` / `[[/SEL]]` 標記選取片段。LLM 被要求回一個 JSON object — 只有 `replacement` 欄位會被套用：

```
System: …strict edit-file instructions…
User:   Instruction: Translate to Japanese.

        Context (with selection marked):
        """
        她…[[SEL]]今天去買菜[[/SEL]]，然後…
        """

        Return JSON: { "replacement": "..." }
```

call 帶 `thinking: 'off'`、`jsonMode: true`、`temperature: 0` — 穩定的編輯，沒有思考鏈洩漏。replacement 用已知 offset（`<input>` / `<textarea>` 是 `selectionStart` / `selectionEnd`；contenteditable 是 live `Range`）直接拼回去。沒有模糊比對，不會洩漏逐字稿。

## 設定

| Option | Default | 說明 |
| --- | --- | --- |
| `llm` | — | `LLMSource`（必填）。 |
| `actions` | 七個預設 | 覆蓋整個 action 清單。 |
| `locale` | `'en'` | `'en' \| 'zh-TW'` 控制內建標籤。 |
| `translateTargets` | en / zh-TW / ja | Translate 子選單會顯示的語言。 |
| `hideAfterMs` | `0` | 沒有 selection change N ms 後自動 hide。`0` = 永不。 |
| `ignoreSelector` | — | 符合的元素內永不觸發。 |
| `shortcut` | `mod+.` | 保留 — 程式化開啟選單的 keyboard shortcut（尚未串接）。 |

## Runtime API

```ts
inline.addAction({
  id: 'my-action',
  label: '…',
  icon: '…',
  instruction: 'Rewrite as if the user were a pirate.',
});
inline.removeAction('translate');         // 丟掉內建
inline.updateAction('improve', { instruction: 'New prompt…' });
inline.setActions([...]);                  // 整批替換
inline.setEnabled(false);                  // 關掉但不 unmount
inline.isEnabled();                        // boolean
inline.destroy();                          // 完全 unmount listener 跟 menu
```

## 動態指令 — 跑之前先問

動作的 `build()` 是啟動當下才跑。可以拿它在 call LLM 之前再問使用者。內建 Translate 的語言挑選器就是這樣；任何自訂流程也適用：

```ts
{
  id: 'translate-custom',
  label: 'Translate to…',
  icon: '文',
  build: async ({ text, agent }) => {
    const target = await myPicker();          // 你自己的 UI / modal / palette
    if (!target) return null;                  // null = 乾淨取消,不 call LLM
    return `Translate to ${target}. Output only the translation.`;
  },
}
```

`build` 跟 `instruction` 都有設的時候 `build` 贏。

## 鍵盤

- `ArrowDown` / `ArrowUp`（或 `Ctrl+N` / `Ctrl+P`） — 移動選擇
- `Mod+Enter`（Cmd / Ctrl / Alt + Enter） — 觸發目前選到的動作。
  單獨按 Enter 不攔截，使用者還是可以在可編輯欄位裡換行。
- `Esc` — 關掉選單

## 持續顯示 — menu 什麼時候出現 / 消失

選單會一直顯示，只要選取還在。捲頁會**重新定位**它（不會 hide）。只有以下情況才會 hide：

- 選取被清空或縮到不到 2 個字元
- 使用者點到沒有選取的地方
- 一個動作跑完
- 按下 `Esc`
- 呼叫 `inline.setEnabled(false)`

可編輯元素**外**的選取不歸這裡處理 — 那種選取會作為 palette context（`palette.context.selectionText`）帶給 agent。

## 定位

選單**預設浮在選取下方**：

- 垂直方向：錨在 `selection.rect.bottom` 下方 6px，往下展開。只有「下方沒空間 **且** 上方還比較多空間」時才翻到選取上方。原本貼齊選取頂端、開在側邊的做法，在窄螢幕上會蓋到使用者自己的文字。
- 水平方向：錨在選取的右側邊緣，超出 viewport 寬度時翻到左邊。

`<input>` 跟 `<textarea>` 的位置用 mirror-div 技巧算（複製 typographic styles，找 `selectionStart` / `selectionEnd` 的 caret 座標）。這很重要：如果用 input 的 bbox 當錨點，menu 會貼在 textarea 邊框，而不是選到的文字旁邊。

## 錯誤處理

LLM provider 錯誤會被「人話化」成一行 subtitle，不讓使用者看到 stack trace。完整 raw error 會進 `console.warn`。常見：

| Status | English subtitle | 中文 subtitle |
| --- | --- | --- |
| 429 | `<vendor> rate limit — wait a few seconds and retry` | `<vendor> 速率上限,稍等幾秒再試` |
| 5xx | `<vendor> is having a moment — please retry` | `<vendor> 暫時忙線,請再試一次` |
| 400 | `<vendor> rejected the request (bad shape)` | `<vendor> 拒絕請求(請求格式問題)` |
| 401 / 403 | `<vendor> auth failed` | `<vendor> 認證失敗` |

## Tear-down

```ts
inline.destroy();
```

移除 listener、主選單、子選單。SPA route 切換 / unmount 一定要呼叫。

也看：[./dwell.md](./dwell.md) 非編輯區的對應 module；[./overview.md](./overview.md) module 索引。
