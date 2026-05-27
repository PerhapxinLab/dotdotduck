# Overview

`@perhapxin/dddk` is a drop-in AI layer for any web product. Install the package, mount one instance, and your users get:

- **Command palette** — `Ctrl+K` opens. Prefix routing, fuzzy search, your custom commands.
- **Web agent** — natural-language tasks that operate the page (click / type / navigate / confirm on destructive actions).
- **Voice input** — hold Space to dictate, optional LLM cleanup pass.
- **Selection AI** — long-press an element (Dwell) for an annotation popover, or select text inside an editable for an inline translate / improve / fix-grammar toolbar.

You **never write UI** for any of this. `dotdotduck` ships its own palette, subtitle bar, mobile chrome, agent cursor, Dwell popover, all styled and themeable via CSS variables. You just register what your product can do (palette items, skills) and bring an LLM.

## 30-second install

```bash
npm install @perhapxin/dddk
```

```ts
import { DotDotDuck, OpenAIProvider } from '@perhapxin/dddk';
import '@perhapxin/dddk/styles.css';

const dotdotduck = new DotDotDuck({
  siteName: 'YourSaaS',
  llm: new OpenAIProvider({ apiKey: process.env.OPENAI_KEY! }),
});
dotdotduck.mount();
```

That's it. `Ctrl+K` works, voice works, Dwell works.

## Where to next

| You want to... | Read |
|---|---|
| Use it in React / Svelte / Next.js / Vue | [01-quickstart-frameworks](./01-quickstart-frameworks.md) |
| Add a `/skill` that runs a guided tour or LLM template | [02-how-to-add-a-skill](./02-how-to-add-a-skill.md) |
| Add a palette command that calls your own code | [03-how-to-palette-commands](./03-how-to-palette-commands.md) |
| Toggle voice / subtitle / dwell on/off | [04-how-to-toggle-features](./04-how-to-toggle-features.md) |
| Change colors / fonts / dark mode | [11-theming](./11-theming.md) |
| Wire your own LLM keys safely (server-side proxy) | [webagent / 09-security](../../webagent/docs/09-security.md) |

## What you DON'T do

- Don't write palette UI yourself — `dotdotduck` renders it.
- Don't proxy events manually — register a palette item, dotdotduck fires its handler.
- Don't roll your own DOM action layer — webagent has 12 built-in actions plus your custom ones.
- Don't ship API keys to the client bundle. Use `ProxyProvider` + a worker that holds the key. See the security guide in webagent.
