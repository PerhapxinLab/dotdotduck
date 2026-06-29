# Session continuity — across pages and tabs

> Status: implemented in `src/agent/webagent/webagent.ts` + `session.ts`.

## What "session" means here

A `AgentSession` is the agent's running state for one task:

```ts
interface AgentSession {
  id: string;
  task: string;           // the user's instruction
  steps: AgentStep[];     // tool calls so far
  status: AgentStatus;
  currentPage: string;    // URL pathname at last step
  startedAt: number;
  updatedAt: number;
  summary?: string;
}
```

Webagent persists this each step. The three places it can live, and what each unlocks:

| Storage          | Same tab nav | Same-origin new tab | Cross-origin | New device |
|------------------|:------------:|:-------------------:|:------------:|:----------:|
| `sessionStorage` |     ✅       |          ❌         |      ❌      |     ❌     |
| `localStorage` + `BroadcastChannel` |     ✅       |          ✅         |      ❌      |     ❌     |
| Host backend     |     ✅       |          ✅         |     ✅       |     ✅     |

## Same-tab navigation (default — sessionStorage)

Out of the box, every webagent instance saves to `sessionStorage[webagent.session]` on every step. When the agent calls `navigate('/billing')`:

- The URL changes (host's `onNavigate` handler).
- React re-renders, host re-mounts dddk on the new page.
- New dddk instance constructs a new WebAgent.
- The WebAgent loop notices the URL change → updates `session.currentPage` and stamps `previousUrl` so the next prompt includes "You arrived from `/crm`".

`sessionStorage` is **per-origin per-tab**, so this works for any same-origin navigation including subdomains? **No** — subdomains have separate sessionStorage. See "Cross-subdomain" below.

To resume on page load (e.g. user refreshed):

```ts
const agent = new WebAgent({ llm });
await agent.resume();  // hydrates from sessionStorage if a session exists
```

dddk does this automatically on `mount()`.

## Cross-tab (same origin) — `crossTabSync: true`

```ts
new WebAgent({ llm, crossTabSync: true });
// or via dddk:
new DotDotDuck({ llm, webAgent: { crossTabSync: true } });
```

What it does:

1. **`localStorage` mirror** — every session save also writes to `localStorage[webagent.session.crosstab]`. A new tab opening on the same origin will read it during construction.
2. **`BroadcastChannel`** — broadcasts the session object to other tabs in real time. Other tabs adopt the broadcast if they are idle (not currently running their own task) and the broadcast is newer than their local session.

So:
- User starts a task in Tab A → opens Tab B on the same origin → Tab B picks up where Tab A left off.
- Both tabs idle → either can resume the task.
- Tab A is mid-run → Tab B sees the update but waits politely (only adopts when idle).

What it doesn't do:
- It does **not** allow two tabs to drive the SAME running agent. Last-writer-wins for the conversation history.
- It does **not** cross origins (browser sandbox).

## Cross-subdomain (e.g. `app.acme.com` ↔ `docs.acme.com`)

The browser treats subdomains as separate origins for `localStorage`/`sessionStorage`. Two patterns:

### Pattern A — cookie + URL hash handoff

Host code on the source page:

```ts
// On the link that goes to docs.acme.com:
const sessionId = dddk.getAgent()?.getSession()?.id;
window.location.href = `https://docs.acme.com/page?dddkSession=${sessionId}`;
```

On the destination subdomain, host reads the URL hash and asks the API for the session:

```ts
const id = new URL(location.href).searchParams.get('dddkSession');
if (id) {
  const session = await fetch(`/a../session/${id}`).then(r => r.json());
  dddk.getAgent()?.adoptSession(session); // future API
}
```

This requires host-side storage (your backend) — there's no client-side cross-origin store.

### Pattern B — third-party iframe

Less recommended (UX is worse). Embed the secondary subdomain as iframe and proxy webagent through `postMessage`.

## Cross-origin (different parent domains)

Not supported client-side, period. If you have two separate brands (`acme.com` and `umbrella-corp.com`) sharing a session, you need a host backend session store. Use the agent's `clearSession()` / `getSession()` to ship JSON over your wire.

## What the agent sees about navigation

Each turn, the prompt includes:

```
- You arrived from: /crm
```

…if `currentPage` changed since the previous step. The agent can use this to make sense of links it followed.

## When to flip `crossTabSync` on

Default: **off** — it costs a `localStorage` write + a `BroadcastChannel` message per step. For most demos that's fine, but on a hot session loop it adds a few ms.

Turn it on when:
- Users actually open new tabs mid-task (common for shop / CRM workflows).
- You have a multi-product suite where users jump between products in new tabs.

Leave it off when:
- Single-product app where users stay in one tab.
- You're using a host backend session store anyway (your store wins).

## What the example demo does

`dddk/example_website/src/App.tsx` sets `crossTabSync: true` so you can:

1. Start a task on `/crm`.
2. `Ctrl+T` open new tab, paste `http://localhost:5174/crm`.
3. New tab adopts the conversation history.

Try it on the Try-It page — step 7.

## Reloading the page — clean-slate by default

Persisted sessions are convenient when the agent navigates between SPA routes, but they can feel haunted when the user hits the browser refresh button: the session is still in `sessionStorage`, but the user's intent is "I want a fresh start." Three API hooks let the host control this:

```ts
// dddk instance (Orchestrator-level helpers):
dddk.resumeAgent();        // pick the loop up where it left off (cross-page reload)
dddk.clearAgentSession();  // wipe the saved session entirely (refresh = clean slate)
dddk.endAgentContinuity(); // close the continuity window now (palette-scoped sessions)
```

The recommended onMount pattern: read `performance.getEntriesByType('navigation')[0]?.type` and treat `'reload'` / `'back_forward'` as a clean slate.

```ts
const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
if (nav?.type === 'reload' || nav?.type === 'back_forward') {
  dddk.clearAgentSession();
}
```

SPA navigates via the SDK's `navigate` tool do NOT re-mount the layout, so this branch only fires on real reloads. The agent's own cross-page navigation continues to work inside the same async generator without needing `resumeAgent()` — `resumeAgent()` is only for the rarer case of a full-page reload triggered mid-task.
