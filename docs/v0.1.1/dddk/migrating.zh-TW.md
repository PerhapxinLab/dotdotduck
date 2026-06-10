# 從 0.1.0 升級到 0.1.1

短版：**多數 host 不用改任何東西**。所有 0.1.0 的設定都繼續可用。

下面這份是新功能採用路徑 + deprecated 名稱的 rename 建議。

## 1. 升級套件

```bash
npm install @perhapxin/dddk@0.1.1
```

最低升級就這樣。

## 2. 可選 — 採用新的 LLM router 名稱

如果你有設 per-role provider，rename：

```diff
 const router: LLMRouter = {
   webagent: mainProvider,
-  webagentWithSelection: visionProvider,
-  inline: utilityProvider,
-  voiceCleanup: utilityProvider,
+  vision: visionProvider,
+  utility: utilityProvider,
   plan: planProvider,
 };
```

舊欄位名仍可用透過 fallback chain。哪個名字寫哪邊都行，純粹是命名整理。

## 3. 可選 — 採用 `disableConfirmations`

Demo / docs / 唯讀網站沒有破壞性 action 要 gate 的話：

```diff
 new DotDotDuck({
   webAgent: {
+    disableConfirmations: true,
     ...
   },
 });
```

設 true 後 per-action `requireConfirmation` 會被全域覆寫掉。

## 4. 可選 — 採用 `navigate.note`

想讓 navigate confirm 用你品牌的口吻，引導 model 在 tool call 內填 `note`。`note` 已經是 built-in `navigate` action 的內建 arg — 不用額外 host config，只要在 `appendSystemPrompt` 內提一下：

```ts
appendSystemPrompt: `
呼叫 navigate 時，請在 \`note\` 內以使用者語言、團隊口吻寫一句話。runtime 會把那句話當作 confirm 文案顯示。
`,
```

`note` 為空就回 SDK 預設文案。

## 5. 可選 — 採用 Memory v1

三層 opt-in。最容易的起手：只開 `core` 給 user profile：

```ts
new DotDotDuck({
  memory: {
    core: { schema: { language: 'string', tone: 'string' } },
  },
});
```

開 `episodic` 讓跨 session 有續接：

```ts
memory: {
  core: { ... },
  episodic: { enabled: true, replayTopK: 3 },
},
```

接 `semantic` 需要你已經有 vector store / KG 可接：

```ts
memory: {
  semantic: { provider: myProvider }, // host 自接
},
```

`MemoryProvider` interface：

```ts
interface MemoryProvider {
  remember(entry): Promise<string>;
  recall(query, opts?): Promise<SemanticMemoryEntry[]>;
  forget(id): Promise<void>;
  list?(opts?): Promise<SemanticMemoryEntry[]>;
}
```

接上之後，agent 的 `startAgent` 會自動把 `memory.buildContext(task)` prepend 到 prompt。

## 6. Rename — Memory → DrawerMemory

verbatim drawer + BM25 store 改名了：

```diff
-import { Memory, createMemory } from '@perhapxin/dddk';
+import { DrawerMemory, createDrawerMemory } from '@perhapxin/dddk';

-const mem = new Memory({ customerId: 'u-123' });
+const mem = new DrawerMemory({ customerId: 'u-123' });
```

舊名仍 resolve。0.2 會 log deprecation warning。

新的 `Memory` 名字現在指 3 層 hybrid class。如果你還在用 BM25 store，switch 過去 `DrawerMemory`，import 才不會誤會。

## 7. Envelope 形狀（進階）

只有直接讀 parsed envelope（自製 analytics / debug）才會 care。

```diff
 turn_planning: {
-  last_turn_outcome,
-  current_page_observation,
-  this_turn_does,
-  will_finish_this_turn,
+  evaluation_previous_goal,
+  next_goal,
 }
 actions: [
-  { task_finish: true },
   ...
 ]
+is_final?: boolean
```

Parser 仍接受舊形狀，自動折成新欄位。如果你在 dashboard 顯示 envelope 內容，switch 到新名才不會看到 ghost field。

## 8. 行為改動須知

- **`sessionContinuityMs` 預設原本就是 5 分鐘**（SDK 內定）。如果你之前在 host 端顯式設 `0` 強制 amnesia（之前的 dddk-frontend 設定就是），移除這個 override 就會回到正常 continuity；想要強制 amnesia 就保留設定
- **`navigate` 自動 clear is_final** — 同一 turn 在 navigate 後設 `is_final: true`，runtime 會 drop 掉並讓 loop 繼續到下個 turn，這樣才看得到新頁面 DOM

## 其他

沒提到的東西行為跟 0.1.0 一樣。如果有壞掉，那是 bug — 請開 issue。
