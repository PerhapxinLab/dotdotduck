# Quickstart — any framework

`dotdotduck` is pure DOM. It doesn't import React, Svelte, Vue, or Next — it just attaches to the page. You can use it in any frontend stack.

Three things to get right:

1. **Mount once**, after the DOM is ready, **not on every render**.
2. **Tear down** on unmount with `dotdotduck.destroy()` to free listeners + clear the BroadcastChannel.
3. **Import the styles** with `import '@perhapxin/dddk/styles.css'` — once, anywhere in your app entry.

Below are working snippets per framework.

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

The DOM doesn't exist server-side — mount in a client component.

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

Use `ProxyProvider` (not direct `OpenAIProvider`) so the key stays on your Next.js API route.

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

## Vanilla HTML / static site

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

## Where keys live

In every snippet above, `apiKey` ends up in the JS bundle visible to the browser. **That's fine for local dev** and **not OK for production**. In production, swap `OpenAIProvider` for `ProxyProvider` pointing at a backend route (Next API route, Cloudflare Worker, Express endpoint, whatever) that holds the real key as a secret.

```ts
new ProxyProvider({ endpoint: 'https://your-backend.com/api/llm' });
```

The proxy speaks the OpenAI chat-completions shape, so any plain pass-through works.

---

## Server-side rendering (SSR / SSG)

`dotdotduck` reads `document` and `window` so it must NOT run during SSR. The framework snippets above all wrap the construction inside an `onMount` / `useEffect` / client component. If you see `ReferenceError: document is not defined`, you're calling `new DotDotDuck()` during render — move it into a client lifecycle hook.
