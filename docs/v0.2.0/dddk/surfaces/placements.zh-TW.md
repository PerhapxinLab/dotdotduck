# Placements — 畫面標準 slot

> 每個 transient UI（subtitle bar、indicator chip、palette、dock、modal、banner、FAB、toast）都該走同一份 CSS。`Placements` 把這些 slot 集中起來，host 加自己的 UI 也用同一套座標系。

## 為什麼

過去 subtitle / mobile-trigger / proactive renderer / palette 各自寫 `position: fixed; bottom: 24px; left: 50%; …`。同樣意思的程式碼散在六七個檔案，每次微調就 drift。一份 stylesheet 把 slot 與 z-index 集中管理，要動就動一處。

## 8 個 slot

| slot | 位置 | z-index | 用途 |
| --- | --- | --- | --- |
| `subtitle` | 中央底部水平條 | 9500 | 主要字幕、agent prose、proactive prompt |
| `indicator` | 中央底部小晶片（在 subtitle 之上） | 9510 | 語音狀態、處理中圖示 |
| `palette` | 上方居中 modal-like 輸入面板 | 9600 | CommandPalette / PanelRuntime |
| `dock` | 右側貼邊長條，從上到下 | 9400 | 持久側邊面板（chat history、inspector） |
| `modal` | 全螢幕居中 + backdrop | 9700 | 全注意力 dialog、表單 |
| `banner` | 全寬置頂條 | 9300 | 系統訊息、版本提醒 |
| `fab` | 右下圓形浮動按鈕 | 9200 | 行動裝置主要 trigger |
| `toast` | 上方居中 transient 通知 | 9800 | 短暫成功 / 錯誤訊息 |

z-index ladder（低到高）：`fab(9200) < banner(9300) < dock(9400) < subtitle(9500) < indicator(9510) < palette(9600) < modal(9700) < toast(9800)`。

## API

```ts
import {
  Placements,
  applyPlacement,
  clearPlacement,
  ensurePlacementStyles,
  PLACEMENT_ATTR,
} from '@perhapxin/dddk';
import type { PlacementSlot, PlacementHandle } from '@perhapxin/dddk';

type PlacementSlot =
  | 'subtitle' | 'indicator' | 'palette' | 'dock'
  | 'modal'    | 'banner'    | 'fab'     | 'toast';
```

### 低階：`applyPlacement(el, slot)`

把 slot CSS class（其實是 `data-dddk-slot="<slot>"` attribute）貼到 element 上。host 自己 append 到 DOM，但定位由 dddk stylesheet 管。

```ts
const el = document.createElement('div');
el.textContent = '上傳完成';
document.body.appendChild(el);
applyPlacement(el, 'toast');     // 出現在右上居中區
// 三秒後
setTimeout(() => clearPlacement(el), 3000);
```

`ensurePlacementStyles()` 在第一次呼 `applyPlacement` 時自動跑，把 stylesheet inject 一次（idempotent）。

### 高階：`Placements.mount(slot, content)`

如果不想自己處理 element 生命週期，用這個 helper：

```ts
const placements = new Placements();

const handle: PlacementHandle = placements.mount('subtitle', `<div>正在思考…</div>`);
// ... 之後
handle.update(`<div>找到 3 筆結果</div>`);
handle.unmount();
```

`mount` 接 string（當 innerHTML）或 HTMLElement（appendChild）。回傳的 handle 有 `update(html)` 與 `unmount()`，host 寫小元件很省事。

## 何時選哪個 slot

| 情境 | 用什麼 | 理由 |
| --- | --- | --- |
| 「我做完了」一句話 | `subtitle` | 不擋畫面、可忽略、語音對應 |
| 「正在錄音」 indicator | `indicator` | 跟 subtitle 一起顯示但不混淆內容 |
| `/command` 輸入面板 | `palette` | dddk 內建已用 |
| 客服 chat 視窗、code inspector | `dock` | 持久、使用者要關才關 |
| 「請填這份表單才能繼續」 | `modal` | 全注意力，使用者必須處理 |
| 「v2.0 已上線」 | `banner` | 全寬、不擋互動但醒目 |
| 行動裝置 ⌘K 按鈕 | `fab` | 桌面快捷鍵的替代入口 |
| 「已複製」「儲存成功」 | `toast` | 短暫、不需要使用者回應 |

決策路徑：
1. 需要使用者回應嗎？是 → `modal`，否 → 2。
2. 會一直在那嗎？是 → `dock` / `banner` / `fab`，否 → 3。
3. 是 transient 通知嗎？是 → `toast`，否 → `subtitle` / `indicator`。

## 客製外觀

每個 slot 暴露 CSS variable（位置、寬度、z-index）：

```css
:root {
  --dddk-bar-bottom: 32px;            /* subtitle 離下緣 */
  --dddk-bar-max-width: 880px;
  --dddk-palette-top: 8%;             /* palette 離頂 */
  --dddk-palette-max-width: 720px;
  --dddk-dock-width: 420px;
  --dddk-modal-backdrop: rgba(15, 23, 42, 0.6);
  --dddk-fab-right: 24px;
  --dddk-fab-bottom: 32px;
  --dddk-toast-top: 32px;
}
```

整套 z-index 也是 var（`--dddk-z-bar` / `--dddk-z-palette` / …），host 可以重排層級而不必 fork CSS。

## 與 SurfacePlacement 的關係

`SurfacePlacement`（在 `SkillTools.surface(...)` / `SurfaceSkill` 用的字串）與 `PlacementSlot` 名稱相同，可以直接互傳：

```ts
import type { SurfacePlacement, PlacementSlot } from '@perhapxin/dddk';

const slot: PlacementSlot = (surfacePlacement === 'center' ? 'modal' : surfacePlacement);
applyPlacement(myDialog, slot);
```

（`'center'` 是舊別名，等同於 `'modal'`。）

## 跨文件

- [Surface renderer](./renderer.md) — 渲染出來的 element 放進哪個 slot 用 `applyPlacement`。
- [Pieces catalog](./pieces-catalog.md) — Piece 不該自己 `position: fixed`；交給 placement。
