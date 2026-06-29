# LLM router

> Pass one provider, get one model everywhere. Pass an `LLMRouter`, get **per-role dispatch** — cheap model for short edit-an-input jobs, smart model for the main agent loop. Same process, no network hop, no extra config surface.

## Why a router (not just `llm: provider`)

Most webagent installs start with a single `LLMProvider`:

```ts
new WebAgent({ llm: new OpenAIProvider({ apiKey, model: 'gpt-5.4-mini' }) });
```

That's fine until you notice the **agent loop** (multi-step reasoning over screenshots, sitemap, action history) wants a smart model — but **inline AI** ("rewrite this input", "clean this voice transcript") wants something tiny and cheap because it runs on every keystroke / mic event.

Hard-coding two providers and `if/else`-ing them at every call site is the wrong shape. The router lets you declare the mapping once, then the agent picks the right one per role automatically.

## Quick start

```ts
import { WebAgent, OpenAIProvider, GoogleProvider, type LLMRouter } from '@perhapxin/dddk';

const router: LLMRouter = {
  webagent: new OpenAIProvider({ apiKey, model: 'gpt-5.5' }),              // smart, expensive
  webagentWithSelection: new OpenAIProvider({ apiKey, model: 'gpt-5.4-mini' }),
  inline: new GoogleProvider({ apiKey: google, model: 'gemini-3.1-flash-lite-preview' }),
  voiceCleanup: new GoogleProvider({ apiKey: google, model: 'gemini-3.1-flash-lite-preview' }),
};

new WebAgent({ llm: router });
```

`WebAgent` accepts `LLMProvider | LLMRouter` interchangeably — internally everything goes through `resolveLLM(source, role)`.

## The role list

The full list comes from `LLMRouterRole` in the source. v1 has four roles:

| Role | What runs here | Fallback |
|---|---|---|
| `webagent` | Main agent loop (multi-step plan + DOM actions). **Required.** | — |
| `webagentWithSelection` | Same loop, but opened with a user selection (text highlighted). Often a tighter task → cheaper model is fine. | `webagent` |
| `inline` | Single-shot LLM calls from inline AI (input-field rewrite, translate, summarize). | `webagent` |
| `voiceCleanup` | Tiny model post-processing voice transcripts (drop fillers, fix punctuation). | `webagent` |
| `plan` | One-shot planning calls from the [Plan module](../agent/plan.md) — produces the master todos list before the webagent turn loop. Also used for markdown LLM edits. | `webagent` |

Only `webagent` is required. Everything else falls back if unset, so you only declare the overrides that matter.

## How resolution works

`resolveLLM` is a one-line dispatcher:

```ts
import { resolveLLM, isLLMRouter, type LLMSource } from '@perhapxin/dddk';

function resolveLLM(source: LLMSource, role: LLMRouterRole): LLMProvider {
  if (!isLLMRouter(source)) return source;       // single provider → use everywhere
  switch (role) {
    case 'webagent':              return source.webagent;
    case 'webagentWithSelection': return source.webagentWithSelection ?? source.webagent;
    case 'inline':                return source.inline ?? source.webagent;
    case 'voiceCleanup':          return source.voiceCleanup ?? source.webagent;
    case 'plan':                  return source.plan ?? source.webagent;
  }
}
```

`isLLMRouter` duck-types on `{ webagent: { complete } }` (not just `!complete`) so an `LLMProvider` implemented via a subclass / proxy where `complete` sits on the prototype doesn't get misclassified.

Calling sites look like:

```ts
const llm = resolveLLM(this.config.llm, 'inline');
const result = await llm.complete({ messages, ... });
```

No string lookups, no factory dance — `LLMProvider` is a stable interface so the agent loop / inline tools don't care which vendor came back.

## Same provider, different model

You don't need different vendors to benefit. Same OpenAI key, two models:

```ts
const router: LLMRouter = {
  webagent: new OpenAIProvider({ apiKey, model: 'gpt-5.5' }),
  inline:   new OpenAIProvider({ apiKey, model: 'gpt-5.4-nano' }),
};
```

Or registry-driven (see [adapters](./adapters.md)):

```ts
import { seedDefaultAdapters, createProvider } from '@perhapxin/dddk';
seedDefaultAdapters();

const router: LLMRouter = {
  webagent: createProvider('openai:gpt-5.5',     { apiKey }),
  inline:   createProvider('openai:gpt-5.4-nano', { apiKey }),
};
```

## Mix-and-match across vendors

Cheap-and-fast Gemma for inline rewrites + flagship GPT for the agent:

```ts
const router: LLMRouter = {
  webagent:     new OpenAIProvider({ apiKey: openai, model: 'gpt-5.5' }),
  inline:       new GoogleProvider({ apiKey: google, model: 'gemma-4-26b-a4b-it' }),
  voiceCleanup: new GoogleProvider({ apiKey: google, model: 'gemma-4-26b-a4b-it' }),
};
```

Function-calling shape is normalized inside the provider, so the agent doesn't care that one role is OpenAI and another is Google.

## Production wiring with ProxyProvider

In production the router still works — just point each role at a different backend route (or the same route with different `model`):

```ts
import { ProxyProvider, type LLMRouter } from '@perhapxin/dddk';

const router: LLMRouter = {
  webagent: new ProxyProvider({ endpoint: '/api/llm', headers: { 'X-Role': 'webagent' } }),
  inline:   new ProxyProvider({ endpoint: '/api/llm', headers: { 'X-Role': 'inline' } }),
};
```

Server decides which upstream model to call based on `X-Role`. Client bundle never sees a vendor key. See [security](../agent/security.md) for the proxy pattern.

## When you don't need a router

If you're shipping a demo, a small internal tool, or you genuinely don't care about per-role cost — just pass a single provider. The router is a tool for cost-shape problems, not a mandatory layer.

```ts
new WebAgent({ llm: new OpenAIProvider({ apiKey, model: 'gpt-5.4-mini' }) });
```

This goes through `resolveLLM` too — `isLLMRouter` returns `false` and the same provider is handed back for every role.

## See also

- [Providers](./providers.md) — `OpenAIProvider`, `GoogleProvider`, `ProxyProvider`.
- [Adapters](./adapters.md) — the registry behind `createProvider`.
- [Prompt design](../agent/prompt-design.md) — what runs in which role, and why a small model survives the inline / voice cases.
