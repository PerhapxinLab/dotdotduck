# v0.1.2 釋出說明

純 bug 修復版本，疊在 v0.1.1 上。**沒有 API 變動、沒有破壞性改動**，直接升上來就好。

## 一句話總結

- 修好「兩個 agent turn 中間 subtitle bar 變空殼」的 bug — 使用者按 Space 過完 auto-pause 之後，下一輪 LLM TTFT 那 1-3 秒會盯著一個只有 × 的空 bar。

## 改動內容

### Pause 的 onAccept 改成顯示 thinking pip、不再留空殼 bar

**症狀**：使用者按 Space 過完 streaming pause hint 之後，subtitle bar 的文字被清掉、但整個 bar el 還掛在 DOM 上（剩下右上角一顆 ×）。下一輪 LLM 開始講話前的 1-3 秒，使用者看到一個空殼 bar、會以為 agent 壞了。

**根因**：runtime 用 `subtitle.replaceStreamed('')` 把文字清掉，但 bar el 還在、`data-dddk-bar-mode="streaming"` 也還在。`isStreaming()` 回 `true`，導致 orchestrator 在 `'thinking'` event 跳過顯示 indicator pip。

**修法**：post-accept handler 改成先 `subtitle.hide()` 把 bar 整個拆掉、然後立刻 `subtitle.showIndicator('processing', ...)` 把 thinking pip 浮出來。下一個 `text-delta` event 進來時 `ensureStreamingBar` 會建一個全新的 streaming bar 並自動把 pip 蓋掉 — 視覺上連貫、不會有空檔。

[改動 commit](https://github.com/PerhapxinLab/dotdotduck/commit/a72c291)。

## 相容性

從 v0.1.1 升上來純 drop-in。沒有設定要改、沒有 API 要 rename、沒有 envelope 要動。所有 v0.1.1 host 都繼續可用。

## 安裝

```bash
pnpm add @perhapxin/dddk@0.1.2
# or: npm i @perhapxin/dddk@0.1.2
```
