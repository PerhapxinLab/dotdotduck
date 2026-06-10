# v0.1.1 釋出說明

內部重構 + bug 修復版本。**對 0.1.0 既有 host 沒有破壞性改動** — 所有 0.1.0 的 API 形狀都可繼續使用。新增是純 additive，行為調整是收緊預設值。

## 一句話總結

- Memory v1 — 三層 hybrid（`core` / `episodic` / `semantic`）接進 agent loop
- WebAgent envelope 收緊 — `turn_planning` 砍到 2 欄、`task_finish` action 淘汰改成 turn-level `is_final`
- LLM router 從 5 軸收成 4 軸（`webagent` / `vision` / `utility` / `plan`）
- 新增 `WebAgentConfig.disableConfirmations`，給非破壞性網站直接跳過確認
- 新增 `navigate.note` 參數，host 可以自訂 confirm 文案
- 14 個 P0 bug 修復 + 6 個安全強化 + 多個大檔拆分提升可維護性
- 原本的 `Memory`（verbatim drawer + BM25）改名 `DrawerMemory`；舊名保留為 deprecated alias

## Memory v1

opt-in 三層 hybrid 在 constructor 接上：

```ts
import { DotDotDuck } from '@perhapxin/dddk';

const dddk = new DotDotDuck({
  memory: {
    core: { schema: { language: 'string', tone: 'string' } },
    episodic: { enabled: true, replayTopK: 3 },
    semantic: { provider: myVectorStore }, // host 自接
    privacy: { requireConsent: true, retentionDays: 90 },
  },
});
```

- **core** — 結構化 user profile，always-in-context，byte cap + schema 強制 + PII filter
- **episodic** — 過去 session summary 的 ring buffer，每次新 run 自動 replay top-K
- **semantic** — host 自接 `MemoryProvider`（vector store / KG 都行）。SDK 不嵌入也不持久化

接上之後，每次 `startAgent` 都會跑 `dddk.memory.buildContext(task)`，把產出的 context 接在 task 前面。預設關閉。

舊的 `Memory` class（verbatim drawer + BM25）改名 `DrawerMemory` — 為了 0.1.0 既有 host 不炸，舊名仍 export 為 alias。

## WebAgent envelope

CoT envelope 變緊：

```diff
 {
   memory: string,
   turn_planning: {
-    last_turn_outcome: string,
-    current_page_observation: string,
-    this_turn_does: string,
-    will_finish_this_turn: boolean,
+    evaluation_previous_goal: string,
+    next_goal: string,
   },
   todo_adjust?: { remove?, replace? },
   actions: [
     { narrate, about } | { tool, args }
-    | { task_finish: true }
   ],
+  is_final?: boolean,
 }
```

**改了什麼**
- `current_page_observation` 砍掉 — 跟 user message 末尾的 DOM dump 重複
- `will_finish_this_turn` 砍掉 — 跟 actions[] 結束訊號重複
- `task_finish` action 砍掉 — 改成 turn-level `is_final` boolean，schema 順序強制在 actions 之後，逼 model 寫完工作計畫才宣告完成

**Back-compat**
- Parser 把舊版 `{task_finish: true}` 跟 `will_finish_this_turn: true` 自動折成 `is_final`
- 舊欄位名 `last_turn_outcome` / `this_turn_does` 仍可 parse，內部 promote 成新名
- 既有 0.1.0 host 不會看到行為差異，除非直接 inspect parsed envelope 形狀

**Reaction-requiring tools 安全網**
新加：當一個 turn 跑了 `navigate` / `ask_user` / `ask_user_choice`，runtime 自動把 `is_final` drop 掉。結果一定要在下個 turn 看到 DOM 才能宣告 done。會 log warning。

## LLM router 4 軸

```diff
 {
   webagent: provider,
-  webagentWithSelection?: provider,
-  inline?: provider,
-  voiceCleanup?: provider,
+  vision?: provider,
+  utility?: provider,
   plan?: provider,
 }
```

`vision` 改成 capability fallback（帶圖的 message 走這條，沒有就回 `webagent`）。`utility` 收掉所有「給一句話、回一句話」的 single-shot 任務 — inline AI / 語音清理 / immersive translate 都走它。

舊欄位名仍可用透過 fallback chain。新 host 寫新名。

## 新 WebAgentConfig 旗標

### `disableConfirmations: boolean`

全域開關 — 設 true 之後任何 tool call 都不會等使用者確認，包含 `requireConfirmation: true` 的 action。用在 demo / docs / 唯讀網站，confirm 暫停會變成阻力：

```ts
new DotDotDuck({
  webAgent: {
    disableConfirmations: true,
  },
});
```

旗標不設時，per-action `requireConfirmation: true` 仍照原本走預設 destructive-pattern auto-gate。

### `navigate.note` 參數

Model 現在可以在 `navigate` 呼叫時直接傳 natural-language 確認文案：

```json
{ "tool": "navigate", "args": { "path": "/commercial", "note": "我帶您看商業合作方案" } }
```

`note` 有值（trim 後非空）就取代 SDK 預設 confirm message。Fallback chain 不變：per-action override → host `buildConfirmMessage` → SDK default。

## Bug 修復（14 條）

從 0.1.0 漏網的 P0 bug：

- `tts-provider` 空陣列被當成快取 → 永遠拿不到 voices
- `analytics` flush key mismatch → IndexedDB offline buffer 無上限膨脹
- `immersive-translate` 失敗 block 的 `pending` 屬性沒重置 → 永久跳過、重試不到
- `dom-utils.walk` 是 BFS 不是 DFS → markdown 序列化順序跟 DOM 不一致
- `mobile.bindTrigger` listener leak（inline arrow 註冊、named function 移除）
- `command-palette.renderDetailFor` 連按方向鍵時 async race
- `orchestrator.startAgent` 圖片附件分支漏呼叫 `beginAgentRun()` — 下游 intents 全 silent drop
- `search.SearchStore.remove` field-stats 用錯長度 → BM25 `avgFieldLen` 漂移
- `search.lowConfHook` threshold 比較預設值寫成 0 → hook 永不觸發
- `recommend.init` 把空陣列當 truthy → bootstrap 不跑
- `skills.evals.resolvePrompt` 變數名沒做 regex escape
- `Sidebar.svelte` `onDestroy` 內用了 SSR-unsafe audio handler
- `proactive` dismiss penalty 檢查錯欄位 — 把「最近顯示過」當成「最近被 dismiss」
- `dom-renderer.repaint` 每個鍵盤 stroke 都炸掉 input focus

## 安全（6 條）

Worker 側強化：

- `metrics/*` endpoints 有設 `ADMIN_TOKEN` 就強制驗證；`export` 無條件需要
- `events` Origin parsing 包 try/catch — malformed `Origin` header 不再 500
- `events` rate limit 在 `visitor_id` 不存在時 fallback `cf-connecting-ip`
- `llm/image` prompt cap 在 4000 字元
- CSV export escape 開頭的 `= + - @`（Excel formula injection）
- `metrics/overview` sparkline 從 JS-side bucket-by-day 改成 SQL `GROUP BY day` — 長 range 不會 OOM

## 內部重構

不影響 public API。給 contributor 看：

- `command-palette.ts` (2216 → 7 個檔在 `command-palette/`)
- `orchestrator.ts` (1897 → 7 個檔在 `orchestrator/`)
- `webagent.ts` (1810 → 主檔 444 + 4 個檔在 `webagent/runtime/`)
- `subtitle.ts` (1774 → 9 個檔在 `subtitle/`)
- `ui/pieces/builtin.tsx` + `dom-renderer.ts` (1621 → 18 個檔在 `pieces/builtin/` + `pieces/dom/`)
- `UI_ATTR` 8 處 → 統一到 `utils/dom.ts`
- `formatElementSignature` 3 處 → 統一到 `utils/dom.ts`
- `tones` / button variants / base input style：React + DOM renderer 共用
- JSON Pointer（`readPointer` / `applyPointer`）兩個 renderer 共用
- Frontend: `escapeHtml`、`IMMERSIVE_LANGUAGES`、`tr(loc, en, zh)` helper 抽出

## Deprecated（仍 export，0.2 會 warn）

- `LLMRouter.webagentWithSelection` — 用 `vision`
- `LLMRouter.inline` — 用 `utility`
- `LLMRouter.voiceCleanup` — 用 `utility`
- `createMemory()` / `Memory` (verbatim BM25 store) — 改名 `DrawerMemory` / `createDrawerMemory`。舊名仍可用

詳見 [migrating](./migrating.md)。
