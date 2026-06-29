# webagent — 安全性

> **TL;DR**：browser app 的 API key 只有兩個正確答案 — (A) 使用者自己提供且只存在他自己機器上，(B) backend proxy、使用者完全看不到 key。**`.env` 不是萬靈丹** — Vite / Next.js client bundle 裡的 `import.meta.env.*` 是 build 時 inline 進去的，跟硬寫一樣不安全。

## 四種 BYOK 模式（trade-off）

| 模式 | client 看得到 key？ | 適合 |
|---|---|---|
| **A. localStorage（使用者填）** | 看得到（只在他自己機器） | 純本機 demo / 內部工具 / 使用者完全是自己人 |
| **B. `.env` build-time inject** | **看得到（任何使用者都看得到，被 bundle 進 JS）** | ❌ **永遠不要**拿來放 client-only app 的 secret |
| **C. Backend proxy** | **看不到** | production SaaS（**推薦**） |
| **D. OAuth + 短期 token** | 短期 token，不是長期 key | 使用者用 Google / OpenAI OAuth |

webagent 提供三種 `LLMProvider` 對應上面這些：

| Provider | 對應模式 | API key 在哪 |
|---|---|---|
| `OpenAIProvider({ apiKey })` | A / C* | client（傳入時） |
| `GoogleProvider({ apiKey })` | A / C* | client |
| **`ProxyProvider({ endpoint })`** | **C** | **完全 server-side，client 看不到** |

\* 把 OpenAIProvider 包在 backend 也行，但更常見的做法是 host 自己寫一個 fetch wrapper。

## 為什麼 `.env` 對 client app **不安全**

很多人以為「把 key 放 `.env` 就安全了」— 這是誤解。先把以下分清楚：

| 環境 | `.env` 在哪 | client 看得到？ |
|---|---|---|
| **Node.js server**（`process.env`） | 只在 server 機器 | **看不到** ✅ |
| **Vite + `VITE_` 前綴** | build 時 inline 到 JS bundle | **看得到** ❌（DevTools 一打開就看到） |
| **Next.js + `NEXT_PUBLIC_` 前綴** | 同上 | **看得到** ❌ |
| **Next.js 無前綴** | 只有 server component / API route 看得到 | 看不到 ✅ |
| **Vite 無前綴** | client 看不到，但 SSR / build script 會用 | 看不到 ✅ |

**規則**：

```
有「前綴 (VITE_ / NEXT_PUBLIC_ / etc.)」→ 等於公開
是 secret → 永遠走 server endpoint
```

## 推薦做法：ProxyProvider + 你的 backend

### Client 端

```ts
import { WebAgent, ProxyProvider } from '@perhapxin/dddk';

const llm = new ProxyProvider({
  endpoint: '/api/llm/complete',
  // 跨網域 + cookie 認證的話
  credentials: 'include',
  // 加 CSRF token / Bearer token 等
  headers: { 'X-CSRF-Token': window.__csrf },
});

const agent = new WebAgent({ llm });
agent.run('幫我把標題改成「年度報告」');
```

Client 完全看不到任何 API key — 它只看到一個 endpoint。

### Backend 範例（Node.js + Express）

```ts
import express from 'express';
import { z } from 'zod';

const app = express();
app.use(express.json());

const CompleteRequest = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.any() })),
  tools: z.array(z.any()).optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  model: z.string().optional(),
});

app.post('/api/llm/complete', async (req, res) => {
  // 1. AUTH —— 驗使用者有沒有權限呼叫
  const user = await authenticate(req);
  if (!user) return res.status(401).send('unauthorized');

  // 2. RATE LIMIT —— 防濫用
  if (await isRateLimited(user.id)) return res.status(429).send('too many');

  // 3. QUOTA —— 計費 / 額度檢查
  if (await isQuotaExceeded(user.id)) return res.status(402).send('quota exceeded');

  // 4. VALIDATE —— 不要直接信 client payload
  const parsed = CompleteRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).send(parsed.error.message);

  // 5. FORWARD —— key 從 server env 拿
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, // ← server-only secret
    },
    body: JSON.stringify({
      model: parsed.data.model ?? 'gpt-4o-mini',
      messages: parsed.data.messages,
      tools: parsed.data.tools ? parsed.data.tools.map(t => ({ type: 'function', function: t })) : undefined,
      temperature: parsed.data.temperature,
      max_tokens: parsed.data.maxTokens,
    }),
  });

  if (!upstream.ok) {
    return res.status(502).send(await upstream.text());
  }

  const data = await upstream.json();

  // 6. RECORD —— 計費 / log
  await recordUsage(user.id, data.usage);

  // 7. RETURN —— webagent CompleteResult shape
  const choice = data.choices[0];
  res.json({
    content: choice.message.content ?? '',
    toolCalls: choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    })),
    usage: data.usage && {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    },
    finishReason: choice.finish_reason,
  });
});
```

## localStorage 什麼時候可以接受

只有以下條件**全部成立**才行：

- ✅ 純本機 demo（不對外）
- ✅ 使用者 100% 知道並同意（要有明確 UI 警告）
- ✅ 不會跨使用者 / 不會被 phishing 站偷
- ✅ XSS 風險已經可控（你的 host 沒有任何使用者輸入 inject 的地方）

而且還要：
- 顯眼的 UI 告訴使用者「key 存在你瀏覽器，請不要在公用電腦上輸入」
- 提供「登出 / 清除 key」按鈕

dddk demo 就是這個用法 — `dddk/example_website/` 有明確警示。**正式產品請走 ProxyProvider**。

## 其他安全 checklist

### Action 安全
- ✅ `ActionDefinition.requireConfirmation = true` — destructive action 一律要加（寄 email / 刪訂單 / 付款）
- ✅ `clear_input` / `set_text` 不能對 password input 動手
- ✅ `eval_js` action 永遠不要實作
- ✅ host 註冊的 custom action 要自己負責 input validation

### XSS / CSP
- webagent 不 eval、不對使用者內容 innerHTML（除了 immersive-translate 的 `preserveHtml` 模式 — 那是來自 LLM 翻譯）
- Piece catalog 元件一定要 escape 掉所有 user-supplied props（內建 catalog 已經做了）
- host CSP 建議：`script-src 'self'; connect-src 'self' https://api.openai.com https://generativelanguage.googleapis.com;`

### Storage scope
- `sessionStorage`（我們 session 用的） — 跨 tab 不共享，關掉 tab 就清掉，比較安全
- `localStorage`（host 用 storage adapter 時）— 跨 tab 共享，要自己權衡

### Network
- Piece surface / agent message 內容不要塞使用者 PII 以外的隱私資料
- LLM provider 預設不 retain user data 的設定（OpenAI 有 API 層的 zero-retention 選項，Gemini 預設不收）— host 自己跟 provider 簽合約

## 結論

| 部署場景 | 建議 |
|---|---|
| 本地單機 demo | `OpenAIProvider({ apiKey })` + localStorage **加明確警告** |
| 內部企業工具 | ProxyProvider → 自己的 backend → server-side key + 公司 SSO |
| 對外 SaaS | ProxyProvider → 自己的 backend + auth + quota + log |
| 使用者完全 BYOK 的 SaaS | 加密 key 存在 server，使用者 OAuth 進來解密 |

---

## BYOK + provider security modes

LLM provider 對 endpoint 保持中立 — 套件本體不挑邊，但**你怎麼接、key 放哪**會直接決定上線會不會爆。三個模式對應三種 provider 用法：

### 模式 A — 直連官方 API（dev / 使用者自填 key）

```ts
import { OpenAIProvider } from '@perhapxin/dddk';

const llm = new OpenAIProvider({ apiKey: userEnteredKey });
new WebAgent({ llm });
```

什麼時候用：
- 你在 localhost dev、key 從 `.env` 讀（不 commit）
- 使用者自己填 key 存到 localStorage（**錢永遠是使用者自己付**）
- 後台管理工具，只有自己人在用

什麼時候**絕對不能用**：把 `apiKey: import.meta.env.VITE_OPENAI_KEY` 寫進 production build → 全網開放 key。

### 模式 B — Cloudflare AI Gateway / 其他 OpenAI-compatible gateway

```ts
const llm = new OpenAIProvider({
  apiKey: 'sk-...',
  baseURL: 'https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway-name>/openai',
});
```

只是換 `baseURL` 而已。**key 還是在 client，跟模式 A 一樣不安全**。AI Gateway 給你的是 logging / cache / fallback / rate limit，**不是安全層**。

把 Gateway 當「便宜的觀測平台」用 OK，當「保護 key 的工具」用就是搞錯了。

### 模式 C — 自己的 backend proxy（**production 唯一安全選項**）

整體架構：

```
browser                     your backend                  OpenAI / Gemini
  │                              │                              │
  │  POST /api/llm               │                              │
  │    body: { messages, ... }   │                              │
  │  ───────────────────────────▶│                              │
  │                              │  Authorization: Bearer KEY   │
  │                              │  ───────────────────────────▶│
  │                              │                              │
  │                              │  ◀──────────────────────────│
  │  ◀───────────────────────────│                              │
```

Browser 那邊只看得到 `/api/llm`，看不到 OpenAI key。Key 留在 server 的環境變數裡。Client 端用 `ProxyProvider` 對接（見上方「推薦做法」一節 — 已示範 Express backend）。

### Server 端範例：Cloudflare Worker（無 framework）

Express 版本見上方。下面是 Worker 版（最小可動，挑你的技術棧抄一份）：

```ts
// worker/src/index.ts
export interface Env {
  OPENAI_API_KEY: string;           // wrangler secret put OPENAI_API_KEY
  DAILY_LIMIT_PER_IP?: string;      // 可選 — 防濫用
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // ── CORS ──────────────────────────────────────────
    const cors = {
      'Access-Control-Allow-Origin': 'https://your-app.com',  // ← 改成你的 origin
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(req.url);
    if (url.pathname !== '/api/llm' || req.method !== 'POST') {
      return new Response('Not found', { status: 404, headers: cors });
    }

    // ── 簡易 rate limit (by IP, 每天 N 次) ────────────
    // 上 production 換成 Durable Object 或 KV 計數；這裡只是示意
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    // ... your rate limit check here ...

    // ── 從 client 拿 CompleteOptions ───────────────────
    const body = await req.json();
    // body = { messages, tools?, temperature?, maxTokens?, model?, thinking?, jsonMode? }

    // ── 轉成 OpenAI request shape 打 upstream ─────────
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,  // ← key 在 server env
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model ?? 'gpt-5.4-mini',
        messages: body.messages,
        tools: body.tools,
        max_completion_tokens: body.maxTokens,
        // ... 其他 OpenAI 欄位
      }),
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      return new Response(JSON.stringify({ error: txt }), {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const data = await upstream.json();
    const choice = data.choices?.[0];

    // ── 轉回 CompleteResult shape ─────────────────────
    return new Response(JSON.stringify({
      content: choice?.message?.content ?? '',
      toolCalls: choice?.message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      usage: data.usage && {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
      },
      finishReason: choice?.finish_reason ?? 'stop',
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
```

要加 Cloudflare AI Gateway：把 `https://api.openai.com/v1/chat/completions` 換成 `https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway>/openai/chat/completions` 就好 — client 端**完全無感**，Gateway 給你的 logging / cache / rate limit 自動繼承。

Next.js Route Handler / Hono 等等同理 — 邏輯一樣，secret 從 `process.env.OPENAI_API_KEY` 拿就好。

### Server 端必做的 4 件事

不管你選哪個 backend，這 4 件**都要做**，少一件 proxy 就等於沒做：

1. **CORS 鎖死你的 origin** — `Access-Control-Allow-Origin` 寫死 production domain，不要寫 `*`，否則隨便一個網站都能盜用你的 key
2. **Rate limit** — 至少按 IP 限制每日次數（Cloudflare Worker 用 Durable Object / KV；Express 用 `express-rate-limit`）。不限 = 被薅羊毛
3. **不要把 request body echo 進 error response** — 直接 `upstream.text()` 回 client 等於把 upstream 錯誤訊息（裡面可能有 key）洩漏出去。包一層
4. **登入 / token 驗證**（如果是付費功能）— `req.headers.get('authorization')` 檢查自家的 JWT / session cookie

⚠️ **最常見的錯誤**：以為「Worker 跑在 Cloudflare 上」就自動安全。**不會**。Worker 確實是 server-side code 沒錯，但如果你把 secret 用 `VITE_*` 前綴寫成 client env、又用 `<script>fetch('https://api.openai.com/...')</script>` 直接打 — 還是會洩漏。Worker secret 一定要用 `wrangler secret put` 設，**不是** `.env`，**也不是** `VITE_*`。

### `dddk.perhapxin.com` / `runboard.perhapxin.com` 怎麼接

這兩個 demo 站走的就是**模式 C**。實際的 worker source 在：
- dddk: `dddk-frontend/` 用 SvelteKit adapter-cloudflare 內建的 server endpoint 當 proxy
- runboard: `runboard-frontend/worker/` 獨立的 Cloudflare Worker

兩邊都用 `wrangler secret put` 把 `OPENAI_API_KEY` / `GOOGLE_API_KEY` 塞進 server env，**完全不靠 `VITE_*`**。在 client bundle grep `sk-` 是空的。
