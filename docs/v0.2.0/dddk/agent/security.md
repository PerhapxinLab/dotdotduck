# webagent — Security

> **TL;DR:** there are only two correct answers for an API key in a browser app — (A) the user supplies it and it lives only on their machine, or (B) a backend proxy hides the key so the client never sees it. **`.env` is not a silver bullet** — `import.meta.env.*` in a Vite / Next.js client bundle is inlined at build time, equivalent to hard-coding the key.

## Four BYOK modes (trade-offs)

| Mode | Client sees key? | Use for |
|---|---|---|
| **A. localStorage (user-supplied)** | Yes (only on their own machine) | Local-only demos, internal tools, fully-trusted users |
| **B. `.env` build-time inject** | **Yes (every visitor sees it — bundled into JS)** | ❌ **Never** for a client-only secret |
| **C. Backend proxy** | **No** | Production SaaS (**recommended**) |
| **D. OAuth + short-lived token** | Short-lived token, not a long-lived key | Users sign in with Google / OpenAI OAuth |

webagent ships three `LLMProvider` implementations covering these:

| Provider | Modes | Where the key lives |
|---|---|---|
| `OpenAIProvider({ apiKey })` | A / C\* | Client (passed in at construction) |
| `GoogleProvider({ apiKey })` | A / C\* | Client |
| **`ProxyProvider({ endpoint })`** | **C** | **Server-side only; client never sees it** |

\* You can also wrap `OpenAIProvider` on the backend, but a custom fetch wrapper is the more common pattern.

## Why `.env` is **not safe** for client apps

A common misconception: "putting the key in `.env` makes it safe." It does not. Distinguish:

| Environment | Where `.env` lives | Client sees? |
|---|---|---|
| **Node.js server** (`process.env`) | Only on the server | **No** ✅ |
| **Vite + `VITE_` prefix** | Inlined into the JS bundle at build | **Yes** ❌ (visible in DevTools) |
| **Next.js + `NEXT_PUBLIC_` prefix** | Same | **Yes** ❌ |
| **Next.js without prefix** | Only server components / API routes can read it | No ✅ |
| **Vite without prefix** | Not exposed to client, but SSR / build scripts can read | No ✅ |

**Rule of thumb:**

```
Has a prefix (VITE_ / NEXT_PUBLIC_ / etc.) → effectively public
Is a secret → always go through a server endpoint
```

## Recommended setup: ProxyProvider + your backend

### Client side

```ts
import { WebAgent, ProxyProvider } from '@perhapxin/dddk';

const llm = new ProxyProvider({
  endpoint: '/api/llm/complete',
  // For cross-origin requests + cookie auth:
  credentials: 'include',
  // Add CSRF / Bearer tokens etc:
  headers: { 'X-CSRF-Token': window.__csrf },
});

const agent = new WebAgent({ llm });
agent.run('Change the headline to "Annual Report"');
```

The client sees nothing but an endpoint — never an API key.

### Backend example (Node.js + Express)

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
  // 1. AUTH — verify the caller has permission
  const user = await authenticate(req);
  if (!user) return res.status(401).send('unauthorized');

  // 2. RATE LIMIT — prevent abuse
  if (await isRateLimited(user.id)) return res.status(429).send('too many');

  // 3. QUOTA — billing / budget check
  if (await isQuotaExceeded(user.id)) return res.status(402).send('quota exceeded');

  // 4. VALIDATE — never trust client payload directly
  const parsed = CompleteRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).send(parsed.error.message);

  // 5. FORWARD — key comes from server env
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

  // 6. RECORD — billing / log
  await recordUsage(user.id, data.usage);

  // 7. RETURN — match the webagent CompleteResult shape
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

## When localStorage is acceptable

Only when **all** of the following hold:

- ✅ Local-only demo (not public)
- ✅ The user is 100% aware and consents (with a clear UI warning)
- ✅ No cross-user exposure / no phishing risk
- ✅ XSS risk is under control (no user content can be injected anywhere)

Plus:
- Display a prominent UI warning: "Your key is stored in this browser; do not enter it on a shared computer."
- Provide a "Sign out / clear key" button.

The dddk demo follows this — the example site warns explicitly. **Production products should always use ProxyProvider.**

## Other security checklist

### Action safety
- ✅ `ActionDefinition.requireConfirmation = true` — always set this for destructive actions (send email, delete order, charge payment).
- ✅ `clear_input` / `set_text` must not target password inputs.
- ✅ Never implement an `eval_js` action.
- ✅ Custom actions registered by the host are responsible for their own input validation.

### XSS / CSP
- webagent does not eval and does not innerHTML user content (except in immersive-translate's `preserveHtml` mode — that content comes from LLM translation).
- Piece catalog components must escape all user-supplied props (the built-in catalog already does).
- Suggested CSP: `script-src 'self'; connect-src 'self' https://api.openai.com https://generativelanguage.googleapis.com;`

### Storage scope
- `sessionStorage` (used for agent sessions) — not shared across tabs, cleared when the tab closes; safer default.
- `localStorage` (when the host uses the storage adapter) — shared across tabs; weigh the trade-off.

### Network
- Never embed user PII or other private data beyond what is strictly required in Piece surfaces or agent messages.
- LLM providers retain user data by default unless you opt out (OpenAI has zero-retention via API tier; Google's Gemini does not retain by default). The host is responsible for the contract with the provider.

## Recommendation by scenario

| Deployment | Recommendation |
|---|---|
| Local demo | `OpenAIProvider({ apiKey })` + localStorage with an explicit warning |
| Internal corporate tool | ProxyProvider → your backend → server-side key + corporate SSO |
| Public SaaS | ProxyProvider → your backend + auth + quota + logging |
| Fully BYOK SaaS | Encrypt user keys server-side; user signs in via OAuth to decrypt |

---

## BYOK + provider security modes

webagent stays endpoint-neutral — the package doesn't pick a side, but **how you wire it and where the key lives** determines whether you blow up in production. Three modes map to three provider usages:

### Mode A — Direct to vendor API (dev / user-supplied key)

```ts
import { OpenAIProvider } from '@perhapxin/dddk';

const llm = new OpenAIProvider({ apiKey: userEnteredKey });
new WebAgent({ llm });
```

When to use:
- You're on localhost, key read from a local `.env` (not committed).
- The user types their own key into localStorage (**costs are theirs**).
- Internal admin tools used only by your team.

When **never** to use: writing `apiKey: import.meta.env.VITE_OPENAI_KEY` into a production build → public key.

### Mode B — Cloudflare AI Gateway / other OpenAI-compatible gateway

```ts
const llm = new OpenAIProvider({
  apiKey: 'sk-...',
  baseURL: 'https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway-name>/openai',
});
```

This only swaps `baseURL`. **The key is still on the client, just as exposed as Mode A.** AI Gateway gives you logging / cache / fallback / rate-limit — it is **not** a security layer.

Using the Gateway as a cheap observability platform is fine. Using it as "key protection" is a misunderstanding.

### Mode C — Your own backend proxy (**the only production-safe option**)

Architecture:

```
browser                     your backend                  OpenAI / Google
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

The browser only sees `/api/llm`, never the OpenAI key. The key stays in server-side env. Client uses `ProxyProvider` (see "Recommended setup" above for an Express implementation).

### Server-side example: Cloudflare Worker (no framework)

The Express version is above. Worker version (minimal, copy what fits your stack):

```ts
// worker/src/index.ts
export interface Env {
  OPENAI_API_KEY: string;           // wrangler secret put OPENAI_API_KEY
  DAILY_LIMIT_PER_IP?: string;      // optional abuse limit
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // ── CORS ──────────────────────────────────────────
    const cors = {
      'Access-Control-Allow-Origin': 'https://your-app.com',  // ← your origin
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(req.url);
    if (url.pathname !== '/api/llm' || req.method !== 'POST') {
      return new Response('Not found', { status: 404, headers: cors });
    }

    // ── Simple rate limit (per IP, N times per day) ───
    // In production, use a Durable Object or KV counter; sketch only here.
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    // ... your rate-limit check ...

    // ── Pull CompleteOptions from the client ──────────
    const body = await req.json();
    // body = { messages, tools?, temperature?, maxTokens?, model?, thinking?, jsonMode? }

    // ── Translate to OpenAI request shape ─────────────
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,  // ← server env
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model ?? 'gpt-5.4-mini',
        messages: body.messages,
        tools: body.tools,
        max_completion_tokens: body.maxTokens,
        // ...other OpenAI fields
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

    // ── Return in CompleteResult shape ────────────────
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

Add Cloudflare AI Gateway by swapping `https://api.openai.com/v1/chat/completions` for `https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway>/openai/chat/completions` — **the client is none the wiser**, and the Gateway's logging / cache / rate-limit applies automatically.

Next.js Route Handlers, Hono, etc. work the same way — the logic is identical; the secret is pulled from `process.env.OPENAI_API_KEY`.

### Four things you must do on the server

Whichever backend you pick, all four must be present — skip any of them and the proxy is no better than nothing:

1. **Lock CORS to your origin** — hard-code your production domain into `Access-Control-Allow-Origin`. Never `*`, or any random site can ride your key.
2. **Rate-limit** — at minimum a per-IP daily cap (Durable Object / KV on Workers; `express-rate-limit` on Express). Unlimited = farm-able.
3. **Don't echo the upstream body into your error response** — `upstream.text()` may contain the upstream provider's error string, sometimes with the key. Sanitize.
4. **Login / token check** (if this is a paid feature) — verify your own JWT / session cookie via `req.headers.get('authorization')`.

⚠️ **Most common mistake:** assuming "the Worker runs on Cloudflare, so it's secure." It is not by virtue of where it runs. The Worker IS server-side code, but if you set the secret as a `VITE_*` env and call `fetch('https://api.openai.com/...')` from a `<script>` tag, the key still leaks. Worker secrets must be set via `wrangler secret put` — **not** `.env`, **not** `VITE_*`.

### How `dddk.perhapxin.com` / `runboard.perhapxin.com` are wired

Both demo sites use **Mode C**. The actual worker sources:
- dddk: `dddk-frontend/` uses SvelteKit's `adapter-cloudflare` server endpoints as the proxy.
- runboard: `runboard-frontend/worker/` is a standalone Cloudflare Worker.

Both inject `OPENAI_API_KEY` / `GOOGLE_API_KEY` into server env via `wrangler secret put` — **no `VITE_*` involvement**. Grep the client bundle for `sk-` — you'll find nothing.
