# 快速上手 — 任何框架

`dotdotduck` 是純 DOM。它不 import React、Svelte、Vue 或 Next — 就只是掛到頁面上。任何前端 stack 都能用。

有三件事要做對：

1. **只 mount 一次**，等 DOM ready 之後，**不要每次 render 都 mount**。
2. **unmount 時記得 tear down**，呼叫 `dotdotduck.destroy()` 釋放 listener 並清掉 BroadcastChannel。
3. **import 樣式** `import '@perhapxin/dddk/styles.css'` — 在你的 app entry 任一處 import 一次就好。

下面是各框架可直接用的片段。

---

## React (Vite / CRA / etc.)

```tsx
// src/components/Dddk.tsx
import { useEffect } from 'react';
import { DotDotDuck, OpenAIProvider } from '@perhapxin/dddk';
import '@perhapxin/dddk/styles.css';

export function DddkProvider({ apiKey }: { apiKey: string }) {
  useEffect(() => {
    const dotdotduck = new DotDotDuck({
      siteName: 'Acme',
      llm: new OpenAIProvider({ apiKey }),
    });
    dotdotduck.mount();
    return () => dotdotduck.destroy();
  }, [apiKey]);

  return null; // dotdotduck renders its own overlays
}

// src/App.tsx
import { DddkProvider } from './components/Dddk';
export default function App() {
  return (
    <>
      <DddkProvider apiKey={import.meta.env.VITE_OPENAI_KEY} />
      {/* …your app… */}
    </>
  );
}
```

---

## Next.js (App Router)

DOM 在 server-side 不存在 — 要在 client component 裡 mount。

```tsx
// app/dotdotduck-provider.tsx
'use client';
import { useEffect } from 'react';
import { DotDotDuck, ProxyProvider } from '@perhapxin/dddk';
import '@perhapxin/dddk/styles.css';

export default function DddkProvider() {
  useEffect(() => {
    const dotdotduck = new DotDotDuck({
      siteName: 'Acme',
      llm: new ProxyProvider({ endpoint: '/api/llm' }),
    });
    dotdotduck.mount();
    return () => dotdotduck.destroy();
  }, []);
  return null;
}

// app/layout.tsx
import DddkProvider from './dotdotduck-provider';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <DddkProvider />
        {children}
      </body>
    </html>
  );
}
```

用 `ProxyProvider`（不是直接 `OpenAIProvider`），這樣 key 才會留在你的 Next.js API route。

---

## SvelteKit

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { DotDotDuck, OpenAIProvider } from '@perhapxin/dddk';
  import '@perhapxin/dddk/styles.css';

  let dotdotduck: DotDotDuck | null = null;

  onMount(() => {
    dotdotduck = new DotDotDuck({
      siteName: 'Acme',
      llm: new OpenAIProvider({ apiKey: import.meta.env.VITE_OPENAI_KEY }),
    });
    dotdotduck.mount();
  });
  onDestroy(() => dotdotduck?.destroy());
</script>

<slot />
```

---

## Vue 3

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { DotDotDuck, OpenAIProvider } from '@perhapxin/dddk';
import '@perhapxin/dddk/styles.css';

let dotdotduck: DotDotDuck | null = null;

onMounted(() => {
  dotdotduck = new DotDotDuck({
    siteName: 'Acme',
    llm: new OpenAIProvider({ apiKey: import.meta.env.VITE_OPENAI_KEY }),
  });
  dotdotduck.mount();
});
onUnmounted(() => dotdotduck?.destroy());
</script>

<template>
  <RouterView />
</template>
```

---

## Vanilla HTML / 靜態站

```html
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@perhapxin/dddk/dist/styles.css" />
  </head>
  <body>
    <!-- your page -->

    <script type="module">
      import { DotDotDuck, OpenAIProvider } from 'https://cdn.jsdelivr.net/npm/@perhapxin/dddk/+esm';
      new DotDotDuck({
        siteName: 'Acme',
        llm: new OpenAIProvider({ apiKey: 'sk-...' }),
      }).mount();
    </script>
  </body>
</html>
```

---

## key 放哪裡

上面每個片段裡，`apiKey` 最後都會進到瀏覽器看得到的 JS bundle。**本地 dev 沒差**，**production 不行**。production 時把 `OpenAIProvider` 換成 `ProxyProvider`，指向你後端的 route（Next API route、Cloudflare Worker、Express endpoint 都行），讓真正的 key 以 secret 形式放在後端。

```ts
new ProxyProvider({ endpoint: 'https://your-backend.com/api/llm' });
```

Proxy 講的是 OpenAI chat-completions 格式，所以任何純 pass-through 都行。

---

## Server-side rendering (SSR / SSG)

`dotdotduck` 會讀 `document` 跟 `window`，所以 SSR 期間絕對不能跑。上面各框架的片段都把 construction 包進 `onMount` / `useEffect` / client component。如果你看到 `ReferenceError: document is not defined`，代表你在 render 時就呼叫了 `new DotDotDuck()` — 把它搬進 client lifecycle hook 即可。
