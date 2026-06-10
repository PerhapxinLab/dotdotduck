# Migrating from 0.1.0 to 0.1.1

Short version: **you probably don't need to change anything**. Every 0.1.0 host config keeps working.

The walkthrough below covers the optional adoption paths for new features and the deprecated names you'll want to rename eventually.

## 1. Update the package

```bash
npm install @perhapxin/dddk@0.1.1
```

That's it for the minimum upgrade.

## 2. Optional — adopt new LLM router names

If you're configuring per-role providers, rename:

```diff
 const router: LLMRouter = {
   webagent: mainProvider,
-  webagentWithSelection: visionProvider,
-  inline: utilityProvider,
-  voiceCleanup: utilityProvider,
+  vision: visionProvider,
+  utility: utilityProvider,
   plan: planProvider,
 };
```

Old field names still work through a fallback chain. You can adopt either name on either field; the renames are purely cosmetic.

## 3. Optional — adopt `disableConfirmations`

On demo / docs / read-only sites where there's nothing destructive to gate:

```diff
 new DotDotDuck({
   webAgent: {
+    disableConfirmations: true,
     ...
   },
 });
```

Per-action `requireConfirmation` is now globally overridden when this flag is true.

## 4. Optional — adopt `navigate.note`

If you want navigate confirms to read in your product's voice, instruct the model to fill `note` in its tool calls. The `note` arg lives on the built-in `navigate` action — no host config needed beyond mentioning it in your `appendSystemPrompt`:

```ts
appendSystemPrompt: `
When you call navigate, pass a one-sentence \`note\` in the user's language and your team's voice. The runtime shows that string as the confirm copy.
`,
```

When `note` is empty / missing, the SDK default copy still ships.

## 5. Optional — adopt Memory v1

Three-tier opt-in. Easiest first step: just `core` for a stable user profile:

```ts
new DotDotDuck({
  memory: {
    core: { schema: { language: 'string', tone: 'string' } },
  },
});
```

Add `episodic` for past-session continuity:

```ts
memory: {
  core: { ... },
  episodic: { enabled: true, replayTopK: 3 },
},
```

Add `semantic` only when you have a vector store / KG to wire:

```ts
memory: {
  semantic: { provider: myProvider }, // host wires
},
```

`MemoryProvider` interface:

```ts
interface MemoryProvider {
  remember(entry): Promise<string>;
  recall(query, opts?): Promise<SemanticMemoryEntry[]>;
  forget(id): Promise<void>;
  list?(opts?): Promise<SemanticMemoryEntry[]>;
}
```

When attached, the agent's `startAgent` automatically prepends `memory.buildContext(task)` to the prompt.

## 6. Renamed — Memory → DrawerMemory

The verbatim drawer + BM25 store has been renamed:

```diff
-import { Memory, createMemory } from '@perhapxin/dddk';
+import { DrawerMemory, createDrawerMemory } from '@perhapxin/dddk';

-const mem = new Memory({ customerId: 'u-123' });
+const mem = new DrawerMemory({ customerId: 'u-123' });
```

Old names still resolve. They'll log a deprecation warning in 0.2.

The new `Memory` name is the 3-tier hybrid class. If you're using the BM25 store, switch to `DrawerMemory` to keep the import unambiguous.

## 7. Envelope shape (advanced)

You only care about this if you're reading the parsed envelope directly (custom analytics / debugging).

```diff
 turn_planning: {
-  last_turn_outcome,
-  current_page_observation,
-  this_turn_does,
-  will_finish_this_turn,
+  evaluation_previous_goal,
+  next_goal,
 }
 actions: [
-  { task_finish: true },
   ...
 ]
+is_final?: boolean
```

The parser still accepts the old shapes and folds them into the new fields. If you're displaying envelope contents in a dashboard, switch to the new names so you don't show ghost fields.

## 8. Behaviour changes you should know about

- **Default `sessionContinuityMs` was already 5 min** in 0.1.0 SDK. If you explicitly set it to `0` to force amnesia (the previous dddk-frontend setting), you can remove the override unless you specifically want amnesia.
- **`navigate` runs with auto-clear `is_final`** — if the same turn declared `is_final: true` after a navigate, the runtime drops the flag and continues to the next turn so the new page DOM is read.

## Nothing else

Everything not mentioned above behaves the same as 0.1.0. If something broke, that's a bug — please open an issue.
