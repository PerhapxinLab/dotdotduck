# Palette attachments

The palette can collect **image attachments** — uploaded files or page screenshots — and carry them into whatever the user does next. Attachments live on `palette.context.attachments`; skill handlers read them, and the orchestrator forwards them to the webagent as `selection.images`.

The camera button is **opt-in** — set `camera` on `DotDotDuckConfig` to enable it. Nothing renders if you don't.

```ts
import { DotDotDuck } from '@perhapxin/dddk';
import type { CameraOptions } from '@perhapxin/dddk';

new DotDotDuck({
  camera: {
    mode: 'screenshot',
    title: 'Drag a rect to screenshot · esc cancels',
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
      // SDK already queued it onto palette.context.attachments — usually a no-op.
    },
  },
});
```

---

## `CameraOptions`

| field         | type                                                                  | default       | what it does                                                                |
| ------------- | --------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| `mode`        | `'upload' \| 'screenshot'`                                            | —             | Upload opens a file picker; screenshot draws a region-select overlay.       |
| `onCapture`   | `(file: File \| Blob, source: 'upload' \| 'screenshot') => void`       | —             | Fires after the user picks / crops. The SDK has *already* queued an attachment by then — your callback is for host-level analytics / side-effects. |
| `accept`      | `string`                                                              | `'image/*'`   | Upload mode only. File-picker accept filter.                                |
| `capture`     | `boolean`                                                             | `false`       | Upload mode only. On mobile, opens the camera directly.                     |
| `title`       | `string`                                                              | `'Attach image'` | Tooltip on the camera button.                                            |
| `captureRect` | `(rect) => Promise<Blob \| null>`                                      | —             | Screenshot mode only. dddk renders the crosshair + drag overlay; you turn the rect into a Blob. Required for `mode: 'screenshot'`. |

You can switch modes at runtime: `dddk.palette.setCameraMode('upload')`.

### Screenshot UX flow

1. User clicks the camera icon → palette hides, dddk shows a fullscreen crosshair overlay.
2. User drags a rectangle on the visible page.
3. dddk hands you the rect (viewport coords); your `captureRect` returns a `Blob`.
4. The Blob is auto-queued onto `palette.context.attachments` (as a chip in the palette).
5. `onCapture` fires for any host-side bookkeeping.

Esc, right-click, or releasing on too-small a region (< 8px) cancels at any point.

### Why `captureRect` is on the host

dddk doesn't ship a screenshot backend — `html2canvas` / `modern-screenshot` add ~50KB and have site-specific quirks (CORS, web components, fixed elements). Hosts pick the lib that fits their pages.

The example above uses `html2canvas` with a dynamic import so the lib only loads on first click — keeps the initial bundle slim.

---

## `PaletteAttachment`

```ts
interface PaletteAttachment {
  id: string;
  kind: 'image';
  blob: Blob;
  thumbnailUrl: string;       // object URL for the chip preview
  source: 'upload' | 'screenshot';
  filename?: string;          // present for uploads, absent for screenshots
  sourceUrl?: string;         // page URL the screenshot / upload was made on
}
```

You usually don't construct one directly — the camera flow + `palette.addAttachment(...)` build them for you.

Manual add (e.g. from a drag-drop zone you built yourself):

```ts
dddk.palette.addAttachment({
  kind: 'image',
  blob: file,
  thumbnailUrl: URL.createObjectURL(file),
  source: 'upload',
  filename: file.name,
});
```

Other API on the palette:

```ts
dddk.palette.removeAttachment(id);
dddk.palette.clearAttachments();
dddk.palette.context;  // { selectionText, selectionElement, attachments }
```

---

## How attachments flow

```
camera click / addAttachment()
        │
        ▼
palette.context.attachments  ◄────── chip-bar shows each as a preview
        │
        ▼ (user picks a row / fallback)
handler reads palette.context
        │
        ├── handler does its own thing, OR
        ▼
orchestrator → webagent  ◄────── attachments become selection.images
                                  on the agent turn
```

A skill / fallback handler that wants to use the images:

```ts
{
  id: 'ask',
  name: 'Ask AI',
  fallback: true,
  prefixAcceptsAnyArg: true,
  handler: (p, arg) => {
    const { selectionText, attachments } = p.context;
    p.close();
    dddk.startAgent(arg ?? 'Describe this.', {
      selection: {
        text: selectionText,
        images: attachments.map((a) => a.thumbnailUrl),
      },
    });
  },
}
```

Once the agent reads `selection.images`, dddk clears the attachments from the palette context — they don't survive into the next turn unless the user adds them again.

---

## Chip-bar promotion

When the chip bar has anything in it (selection text, pinned DOM element, or an image attachment), dddk promotes any registered `fallback` row to the **top** of the list so `⏎` immediately routes the captured context to the agent.

Opt out with `contextPromotesFallback: false` on `CommandPaletteOptions` — useful if your palette's primary use of attachments is something other than "ask AI about this image."

---

## Where this shows up in the demo

`dddk-frontend`'s `+layout.svelte` enables `camera: { mode: 'screenshot', captureRect: html2canvas-backed, ... }`. The Ask AI row is registered as a fallback so screenshots flow straight to the webagent with the visible page URL attached as `sourceUrl`.
