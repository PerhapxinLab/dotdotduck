import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['zod'],
    onSuccess: async () => {
      // Ship CSS so `import '@perhapxin/dddk/styles.css'` works:
      //   - dist/styles.css is a single self-contained file (tokens inlined,
      //     no @import) — what hosts actually consume.
      //   - dist/styles/{index,tokens}.css are also there for sub-path imports.
      mkdirSync('dist/styles', { recursive: true });
      copyFileSync('src/styles/tokens.css', 'dist/styles/tokens.css');
      copyFileSync('src/styles/index.css', 'dist/styles/index.css');
      const tokens = readFileSync('src/styles/tokens.css', 'utf-8');
      const index = readFileSync('src/styles/index.css', 'utf-8');
      const combined =
        '/* @perhapxin/dddk — single bundled stylesheet (tokens + index inlined) */\n\n' +
        tokens +
        '\n\n' +
        index.replace(/@import\s+['"]\.\/tokens\.css['"];?\s*\n?/g, '');
      writeFileSync('dist/styles.css', combined, 'utf-8');
    },
  },
  {
    entry: ['src/agent/index.ts'],
    outDir: 'dist/agent',
    format: ['esm', 'cjs'],
    dts: true,
    external: ['zod'],
  },
  {
    // Public subpath @perhapxin/dddk/llm reads from src/agent/llm (LLM layer
    // lives inside the agent subsystem after the 0.1 merge).
    entry: ['src/agent/llm/index.ts'],
    outDir: 'dist/llm',
    format: ['esm', 'cjs'],
    dts: true,
    external: ['zod'],
  },
  {
    entry: ['src/ui/index.ts'],
    outDir: 'dist/ui',
    format: ['esm', 'cjs'],
    dts: true,
    external: ['zod'],
  },
  {
    entry: ['src/skills/index.ts'],
    outDir: 'dist/skills',
    format: ['esm', 'cjs'],
    dts: true,
    external: ['zod'],
  },
  // Toolbox: two host-facing data tools (search / recommend). The rest
  // moved to where they belong — memory → agent, proactive + analytics
  // → modules, storage → utils, qa → palette.addQAItems helper +
  // dddk.tools.registerQA (both use search internally), lang / internals
  // / classify → deleted.
  ...['search', 'recommend', 'common'].map((sub) => ({
    entry: [`src/toolbox/${sub}/index.ts`],
    outDir: `dist/toolbox/${sub}`,
    format: ['esm' as const, 'cjs' as const],
    dts: true,
    external: ['zod'],
  })),
  {
    entry: ['src/toolbox/index.ts'],
    outDir: 'dist/toolbox',
    format: ['esm', 'cjs'],
    dts: true,
    external: ['zod'],
  },
  // Per-feature module subpaths the frontend imports directly.
  {
    entry: ['src/modules/analytics/index.ts'],
    outDir: 'dist/modules/analytics',
    format: ['esm', 'cjs'],
    dts: true,
    external: ['zod'],
  },
  {
    entry: ['src/modules/proactive/index.ts'],
    outDir: 'dist/modules/proactive',
    format: ['esm', 'cjs'],
    dts: true,
    external: ['zod'],
  },
  // Self-hosted analytics layer (EventStore + canonical SQL schema +
  // exporters + mappers). Published at `@perhapxin/dddk/analytics`.
  {
    entry: ['src/analytics/index.ts'],
    outDir: 'dist/analytics',
    format: ['esm', 'cjs'],
    dts: true,
    external: ['zod'],
  },
  // Mini dashboard — vanilla-SVG mount-anywhere charts over an
  // EventStore. Separate entry so the SVG layer is tree-shakeable
  // for hosts that only want the export side of the analytics layer.
  {
    entry: ['src/analytics/dashboard/index.ts'],
    outDir: 'dist/analytics/dashboard',
    format: ['esm', 'cjs'],
    dts: true,
    external: ['zod'],
  },
]);
