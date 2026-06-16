# Migrating from 0.1.1 to 0.1.2

**Nothing to migrate.** v0.1.2 is a pure runtime bug fix — no config changes, no API renames, no envelope changes.

## 1. Update the package

```bash
npm install @perhapxin/dddk@0.1.2
```

That's the entire upgrade. Existing v0.1.1 host config keeps working unchanged.

## 2. What you'll see different at runtime

After Space-accepts the streaming pause hint between narrate beats, the subtitle bar now disappears momentarily and a thinking pip shows up until the next narrate streams in. Previously the bar stayed mounted with empty text for the duration of the next LLM call (1-3s on `gpt-5.4-nano`), which users read as "the agent broke." See the [release notes](./release-notes) for the underlying cause.

## 3. Coming from 0.1.0

If you're skipping 0.1.1 entirely, read the 0.1.0 → 0.1.1 migration guide first — that's the substantive one. The 0.1.1 → 0.1.2 step is trivial on top.
