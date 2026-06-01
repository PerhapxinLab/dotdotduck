# dotdotduck — React Adapter

> dotdotduck core 是純 DOM + event emitter，無框架。React adapter 把它包成 React hooks 讓 React 用戶更舒服。Vue / Svelte 用戶可以直接用 core API，未來有需求再加 adapter。

## 安裝

```bash
npm install @perhapxin/dddk @perhapxin/dddk-react react
```

## Provider 設定

```tsx
import { DddkProvider } from '@perhapxin/dddk-react';
import { OpenAIProvider } from '@perhapxin/dddk';

const llm = new OpenAIProvider({ apiKey: 'sk-...' });

function App() {
  return (
    <DddkProvider
      llm={llm}
      locale="zh-TW"
      skills={[introduce, translate]}
    >
      <Router>
        {/* your app */}
      </Router>
    </DddkProvider>
  );
}
```

`DddkProvider` 內部建一個 `DotDotDuck` instance，mount 到 document，並用 React Context 提供給 children。

## Hooks

### `useDddk()`
拿 dotdotduck instance：

```tsx
function MyButton() {
  const dotdotduck = useDddk();
  return <button onClick={() => dotdotduck.palette.toggle()}>Open Palette</button>;
}
```

### `useSubtitle()`
訂閱字幕條狀態 + 顯示 / 隱藏：

```tsx
function MyComponent() {
  const { text, type, visible, show, hide } = useSubtitle();

  return (
    <button onClick={() => show({ text: 'Hello!', type: 'info' })}>
      Show Subtitle
    </button>
  );
}
```

### `useAgent()`
訂閱 webagent 狀態 + 控制：

```tsx
function AgentControl() {
  const { status, currentStep, subtitle, run, stop } = useAgent();

  return (
    <div>
      <p>Status: {status}</p>
      <p>Subtitle: {subtitle}</p>
      <button onClick={() => run('翻譯這頁')}>Run</button>
      <button onClick={stop}>Stop</button>
    </div>
  );
}
```

### `useSkill(id)`
跑特定 skill：

```tsx
function OnboardingButton() {
  const runSkill = useSkill('introduce');
  return <button onClick={runSkill}>Re-run Onboarding</button>;
}
```

### `usePalette()`
控制 palette：

```tsx
function MyShortcut() {
  const { open, close, isOpen } = usePalette();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && e.ctrlKey) open();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);
}
```

### `useSurface()`
監聽並 render skill / webagent 吐出的 Surface：

```tsx
function SurfaceLayer() {
  const surface = useSurface(); // null when nothing pending

  if (!surface) return null;
  return (
    <Modal onClose={() => surface.dismiss()}>
      <PieceRenderer
        surface={surface.payload}
        catalog={catalog}
        onAction={(action, data) => surface.respond(action, data)}
      />
    </Modal>
  );
}
```

底層 `useSurface` 訂閱 `surface` event，把最新的 payload 跟 helper 一起 expose 出來。資料格式見 [surface-renderer](../surfaces/renderer.md)。

## 元件

### `<Palette />`
如果要在 React tree 內 render palette（而非 dotdotduck 自掛 overlay），可以用元件版：

```tsx
<DddkProvider llm={llm}>
  <Palette renderItem={(item) => <MyItem {...item} />} />
  <App />
</DddkProvider>
```

預設不需要這個 — palette 自己 render 到 `document.body`。

### `<SubtitleBar />`
同上，預設不需要。

### `<SurfaceHost placement="center" />`
Surface 的 portal host — 預先把 `useSurface()` 跟 `PieceRenderer` 接到指定 placement 上。React 用戶可以自己決定 portal target。

## SSR

`DddkProvider` 內部用 `useEffect` mount，SSR 時 skip → 不會 hydration 衝突。Next.js / Remix / SvelteKit 都 OK。

## 跟 Next.js App Router 整合

```tsx
// app/providers.tsx
'use client';

import { DddkProvider } from '@perhapxin/dddk-react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DddkProvider /* ... */>
      {children}
    </DddkProvider>
  );
}

// app/layout.tsx
import { Providers } from './providers';

export default function Layout({ children }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Next.js router 整合：

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { DddkProvider } from '@perhapxin/dddk-react';

export function Providers({ children }) {
  const router = useRouter();
  return (
    <DddkProvider onNavigate={(path) => router.push(path)}>
      {children}
    </DddkProvider>
  );
}
```

## 為什麼分開包 React adapter

- 純 core 用戶不必拉 React peer dep
- React 用戶可以雙包都裝
- Vue / Svelte adapter 未來照樣加

`@perhapxin/dddk-react` 的 peer deps：

```jsonc
{
  "peerDependencies": {
    "@perhapxin/dddk": "^0.1.0",
    "react": "^18.0.0 || ^19.0.0"
  }
}
```

## Vue / Svelte 怎麼辦

直接用 core API：

```vue
<!-- Vue 3 -->
<script setup>
import { DotDotDuck } from '@perhapxin/dddk';
import { onMounted, onUnmounted } from 'vue';

const dotdotduck = new DotDotDuck({ /* config */ });
onMounted(() => dotdotduck.mount());
onUnmounted(() => dotdotduck.destroy());
</script>
```

```svelte
<!-- Svelte 5 -->
<script>
import { DotDotDuck } from '@perhapxin/dddk';
import { onMount, onDestroy } from 'svelte';

const dotdotduck = new DotDotDuck({ /* config */ });
onMount(() => dotdotduck.mount());
onDestroy(() => dotdotduck.destroy());
</script>
```

要 hook-like DX 自己包 composable / store 即可。
