# Palette attachments

Palette 可以收**圖片附件** — 上傳檔案或截圖 — 然後帶到用戶接下來做的事情裡面。附件放在 `palette.context.attachments`，skill handler 自己讀，orchestrator 也會把它丟給 webagent 變 `selection.images`。

相機按鈕是 **opt-in** — 要在 `DotDotDuckConfig` 設 `camera` 才會出來。沒設就什麼都不會 render。

```ts
import { DotDotDuck } from '@perhapxin/dddk';
import type { CameraOptions } from '@perhapxin/dddk';

new DotDotDuck({
  camera: {
    mode: 'screenshot',
    title: '拖一個區域截圖 · esc 取消',
    captureRect: async (rect) => {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(document.body, {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
        backgroundColor: null,
        useCORS: true,
      });
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      );
    },
    onCapture: () => {
      // SDK 已經放進 palette.context.attachments 了 — 通常不用做事。
    },
  },
});
```

---

## `CameraOptions`

| field         | type                                                                  | 預設            | 做什麼                                                                      |
| ------------- | --------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| `mode`        | `'upload' \| 'screenshot'`                                            | —               | upload 開檔案選擇器；screenshot 開區域拖選 overlay。                       |
| `onCapture`   | `(file: File \| Blob, source: 'upload' \| 'screenshot') => void`       | —               | 用戶選 / 截完之後 fire。SDK 那時候**已經**把附件 queue 進去了 — 這個 callback 用來做 host 端的 analytics / 副作用。 |
| `accept`      | `string`                                                              | `'image/*'`     | 只有 upload mode 用。File-picker 的 accept filter。                        |
| `capture`     | `boolean`                                                             | `false`         | 只有 upload mode 用。手機上會直接開相機。                                  |
| `title`       | `string`                                                              | `'Attach image'` | 相機 icon 的 tooltip。                                                    |
| `captureRect` | `(rect) => Promise<Blob \| null>`                                      | —               | 只有 screenshot mode 用。dddk 負責畫十字 + 拖選 overlay；你把 rect 轉成 Blob。`mode: 'screenshot'` 必填。 |

執行中切 mode：`dddk.palette.setCameraMode('upload')`。

### 截圖 UX

1. 用戶點相機 icon → palette 隱形，dddk 顯示一個全螢幕的十字 overlay。
2. 用戶在可見頁面上拖一個矩形。
3. dddk 把 rect（viewport 座標）丟給你，`captureRect` 回一個 `Blob`。
4. 那個 Blob 自動 queue 進 `palette.context.attachments`（palette 上會看到 chip）。
5. `onCapture` fire 給 host 端做紀錄。

Esc、右鍵、或鬆手太靠近（< 8px）任何時候都可以取消。

### 為什麼 `captureRect` 要放在 host

dddk 不附 screenshot backend — `html2canvas` / `modern-screenshot` 多 ~50KB，而且每個站都有自己怪的 quirks（CORS、web components、fixed 元素 ...）。host 自己挑適合自家頁面的 lib。

上面範例用 `html2canvas` 配 dynamic import — lib 只有用戶第一次按相機才會載入，初始 bundle 不會被拖大。

---

## `PaletteAttachment`

```ts
interface PaletteAttachment {
  id: string;
  kind: 'image';
  blob: Blob;
  thumbnailUrl: string;       // chip 預覽用的 object URL
  source: 'upload' | 'screenshot';
  filename?: string;          // upload 才有，screenshot 沒有
  sourceUrl?: string;         // 截圖 / 上傳發生的那個頁面 URL
}
```

通常不會自己 new — 相機流程跟 `palette.addAttachment(...)` 會幫你建好。

自己手動加（例如你做了 drag-drop 區域）：

```ts
dddk.palette.addAttachment({
  kind: 'image',
  blob: file,
  thumbnailUrl: URL.createObjectURL(file),
  source: 'upload',
  filename: file.name,
});
```

Palette 還有：

```ts
dddk.palette.removeAttachment(id);
dddk.palette.clearAttachments();
dddk.palette.context;  // { selectionText, selectionElement, attachments }
```

---

## 附件怎麼流

```
相機 click / addAttachment()
        │
        ▼
palette.context.attachments  ◄────── chip-bar 每張顯示一個 preview
        │
        ▼ (用戶選了某一列 / fallback)
handler 讀 palette.context
        │
        ├── handler 自己處理，或
        ▼
orchestrator → webagent  ◄────── 附件在 agent turn 變 selection.images
```

要用圖片的 skill / fallback handler：

```ts
{
  id: 'ask',
  name: 'Ask AI',
  fallback: true,
  prefixAcceptsAnyArg: true,
  handler: (p, arg) => {
    const { selectionText, attachments } = p.context;
    p.close();
    dddk.startAgent(arg ?? '描述這張圖。', {
      selection: {
        text: selectionText,
        images: attachments.map((a) => a.thumbnailUrl),
      },
    });
  },
}
```

Agent 讀完 `selection.images` 之後 dddk 會把 palette 那邊的附件清掉 — 不會留到下一輪，除非用戶又附一張。

---

## Chip-bar 自動推 fallback

只要 chip bar 有東西（selection text、pinned DOM 元素、圖片附件），dddk 會把註冊好的 `fallback` 列推到**最頂**，這樣 `⏎` 直接把 context 送到 agent。

不要的話 `CommandPaletteOptions` 設 `contextPromotesFallback: false` — 如果你的 palette 收附件主要不是為了「問 AI 這張圖」就關掉。

---

## demo 在哪裡用

`dddk-frontend` 的 `+layout.svelte` 有開 `camera: { mode: 'screenshot', captureRect: html2canvas-backed, ... }`。Ask AI 那一列註冊成 fallback，所以截圖直接流到 webagent，當下頁面 URL 會帶在 `sourceUrl`。
