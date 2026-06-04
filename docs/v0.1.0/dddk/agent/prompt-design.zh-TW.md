# Prompt 設計 — CoT envelope + 兩大塊 system

> Status: 已實作於 `src/agent/webagent/prompt.ts` + `cot.ts`。

## 模型實際看到什麼

每一輪 webagent 送 OpenAI 的 payload 分四塊：

```
messages[0] system          ← SDK default block + dev block
messages[1..N-1]            ← 歷史 turns（user / assistant(tool_call) / tool）
messages[N] 最後 user msg   ← env block：當前 URL + Page DOM (+ 截圖)
tools[]                     ← 只有一個 agent_turn wrapper
toolChoice                  ← 強制每 turn 只能 call agent_turn
```

兩條設計線：
- **System prompt = SDK 預設 + host 加的 dev block**，串接一次寫好；
- **agent_turn 是 envelope wrapper**，所有 action（narrate / navigate / click …）都包在它的 `actions[]` 裡，model 一個 turn 只 emit 一個 agent_turn。

## System prompt 內容（CoT mode）

`renderCotDefault()` 由上到下吐出：

| 段 | 來源 | 內容 |
|---|---|---|
| identity | `agentName` + `siteName` + 自動 date | `You are <agent> on <site>, an in-page assistant. Today is YYYY-MM-DD.` |
| persona | `WebAgentConfig.persona` | 第一人稱身分聲明（host opt-in） |
| `# Tools` | `renderToolReference(cotToolRefs)` | 每個 action 的 name + description + JSON Schema |
| `# Envelope` | 寫死 | `memory` / `todos_remaining` / `actions` 三欄解釋 |
| `# DOM` | 寫死 | DOM dump 格式說明：`[id]` / `↑↓` / selector 怎麼用 |
| dev block | `appendSystemPrompt` | host 自寫的 sitemap、navigation、narration、language 規則 |

Date 放在最頂端的 identity 行，原因是 session 內穩定 → 不破 prompt cache 前綴。

## agent_turn envelope

```ts
agent_turn({
  memory: string,                    // 1-2 句進度筆記（私下）
  todos_remaining: string[],         // 對原始請求還欠什麼
  actions?: Array<                   // 這 turn 要跑的東西
    { narrate: string } |
    { tool: string, args: object }
  >,
})
```

Runtime 順著 `actions[]` 跑：
- `narrate` → typewriter 串入 subtitle bar，串完自動 pause 等使用者按 Space；
- `tool` → confirm gate（若需要）+ 透過 `executeAction` dispatch；
- `actions: []` 或省略 → loop 結束。

Pause 是 **intra-turn**（同一個 actions[] 內 action 之間）— 不是 turn 之間的 hand-off。要打包多個動作就把它們全部放進同一個 `actions[]`。

## Env block（最後 user message）

`renderPageStateBlock()` 吐：

```
# Current page
- URL: /commercial

# Page DOM
[3a2b]<section>...
↓[4e1c]<table>...
```

+ 如果這 turn 有截圖 / palette 附件，附在同 message 後面當 image content part。

URL 留在這裡是因為它每次 navigate 就變 → 放 system 會破 cache。DOM dump 同理，每 turn 重抓。

## History 不帶 DOM

過去 turn 的 message 只留：
- user turn：使用者當時打的字 + selection（不含 DOM）；
- agent_step：`agent_turn` 呼叫 + tool reply（含 `memory` / `todos_remaining` / `action_results`）；
- agent_final：最後一段文字。

理由：每 turn DOM 一份 3-5K tokens，N turn 累積就 N×。Cache 用 prefix-stability 工作，append-only 歷史本來就會命中；不需要靠 DOM snapshot 拉長 cache window。代價是 model 看不到「我之前在 /pricing 看到的價格表」這種跨頁面內容回憶 — 需要的話 model 自己把重點寫進 `memory` 欄。

## 客製層級

```
systemPrompt: (ctx, defaultPrompt) => string   // 包預設 + 自加段
systemPrompt: string                           // 硬替換整份 system
appendSystemPrompt                             // 接在 SDK default 後（dev block）
actionOverrides[name]                          // 每個 tool description 改寫 / 加料
persona                                        // identity / voice / constraints
```

優先順序：function > string > 否則 default + appendSystemPrompt。`actionOverrides` 跟其他層獨立 — 不論 system prompt 怎麼組，actionOverrides 都會作用在 `# Tools` 區段裡每個 action 的 description 上。

### actionOverrides — 每個 tool 的規則寫在 tool 旁邊

跟某個 tool 綁定的使用規則（「palette 註冊了哪些指令」「navigate 不要 pre-narrate」「border 每段都要先框」）放這裡比放 `appendSystemPrompt` 好 — 規則就在 tool description 後面，model 在 `# Tools` 區段一次看到 tool + 規則，不用上下查找 dev block。

```ts
new WebAgent({
  llm,
  actionOverrides: {
    navigate: {
      appendDescription: '本站使用規則：要到別的 page 直接 call，不要 pre-narrate。',
    },
    click: {
      appendDescription: 'selector 必須是 DOM dump 的 `[id]` 雜湊，不要自己組 `#thing`。',
    },
    border: {
      description: '完全自訂的 description（會取代 SDK 預設那一行）。',
    },
  },
});
```

- `appendDescription` — 在 SDK 預設後面接一個 `\n` 然後接你的內容。最常用。
- `description` — 硬替換，SDK 預設整段不見。少用、慎用。
- 兩個都設時 `description` 勝出。

適用於所有 action — builtin（navigate / click / border ...）、orchestrator 註冊的（`palette_*` agentTool）、host 用 `dddk.tools.register` 註冊的、`customActions` 都吃。

`appendSystemPrompt` 留給跨工具的 cross-cutting 規則：sitemap、語言、narrate 排版風格。

### 80% 場景：`persona` + `appendSystemPrompt`

```ts
new WebAgent({
  llm,
  persona: '你是 Acme 的客服助理，代表 Acme Suite 與使用者互動。講 Acme 提供的東西用「我們」。',
  appendSystemPrompt: [
    '# Sitemap — 使用者想做什麼 → 帶去哪頁',
    '- `/orders` — 看訂單、退貨、發票。',
    '- `/account` — 改個資、付款方式、收件地址。',
    '',
    '# Navigation',
    '要到別的 page 直接 call navigate，不要 pre-narrate。',
    '',
    '# Narration',
    '- 說明網頁內容或導覽時，每段 narrate 都先 border 對應元素再講話。',
    '- 多個項目用 `\\n` 換行拆成一行一個。',
    '',
    '# Language',
    '回覆語言跟使用者最新一句一致；中文用繁體。',
  ].join('\n'),
});
```

### 硬性接管：`systemPrompt: string`

整個 SDK default 都不見了（包括 envelope rules）。要這麼做的話，自己抄一份新的 envelope rules 進去，不然 model 不會知道怎麼 call `agent_turn`。多數情境用 function 形式比較安全。

## Tool 清單怎麼變

CoT mode 下 OpenAI 的 `tools[]` 只放一個 `agent_turn`（強制 toolChoice）。真正的 action（navigate / click / scroll_to / border / fill_input / ...）放在 system prompt 的 `# Tools` 區塊裡，提供 name + description + JSON Schema，讓 model 在 `agent_turn.actions[].tool` 填用。

要新增 action 用 `WebAgentConfig.customActions`，要關掉 builtin 用 `disableBuiltinActions`，要打開 `present_surface` 用 `allowPresent: true`。

## Debug

`window.__dddkDebug.lastLlmMessages` 是上一次送出去的完整 messages 陣列；`window.__dddkDebug.turnLog` 是每一 turn 的 envelope 摘要（最多 50 筆）。Console 也會 `[dddk webagent] turn` 印每 turn 的 memory / todos / actions。

## 為什麼 SDK default 寫英文

LLM 對英文 imperative 最聽話、tool calling 最穩。預設裡 dev block 自己用中文寫就好；reply language 規則放在 dev block，會壓過英文預設。
