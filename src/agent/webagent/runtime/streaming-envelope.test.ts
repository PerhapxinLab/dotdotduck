/**
 * Smoke test for StreamingEnvelopeParser.
 *
 * Not part of a formal test suite (no test runner wired into the SDK
 * package yet); this file is runnable via `pnpm tsx
 * src/agent/webagent/runtime/streaming-envelope.test.ts` and prints
 * the events emitted from feeding a real agent_turn envelope a chunk
 * at a time.
 *
 * Excluded from the published bundle via the `.test.ts` suffix matching
 * the tsup build's default ignore.
 */

import { StreamingEnvelopeParser } from './streaming-envelope';

const ENVELOPE = JSON.stringify({
  memory: 'User asked about pricing; previous turn surfaced the commercial page.',
  turn_planning: {
    evaluation_previous_goal: 'Surfaced commercial copy successfully.',
    next_goal: 'Narrate the Starter / Business tier difference.',
  },
  actions: [
    {
      about: '[a3f1c]',
      narrate: 'Starter is US$350 per year for revenue under one million.',
    },
    {
      about: '[b2e88]',
      narrate: 'Business jumps to US$1,600 — same features, higher revenue band.',
    },
    {
      tool: 'border',
      args: { selector: '[c7d44]' },
    },
  ],
  is_final: false,
});

function chunk(str: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

function main(): void {
  const parser = new StreamingEnvelopeParser();
  const allEvents: unknown[] = [];
  // Whole-envelope chunk — the parser's complete-envelope path.
  // True per-character incremental streaming inside a single string
  // value (so individual narrate chars stream to the subtitle bar as
  // the LLM types them) is the v0.2.0 follow-up; for now the parser
  // requires `feed()` calls to contain at least one complete string
  // boundary. The fallback path in loops.ts catches the bail and
  // hands the args off to `JSON.parse` for that turn.
  for (const ch of chunk(ENVELOPE, ENVELOPE.length)) {
    const events = parser.feed(ch);
    if (events === null) {
      console.error('parser bailed');
      return;
    }
    for (const ev of events) allEvents.push(ev);
  }
  const tail = parser.finish();
  if (tail) for (const ev of tail) allEvents.push(ev);

  console.log(`Got ${allEvents.length} events:`);
  for (const ev of allEvents) {
    console.log(JSON.stringify(ev));
  }

  // Sanity assertions
  const narrateDeltas = allEvents.filter((e: any) => e.kind === 'narrate_delta');
  const narrateCompletes = allEvents.filter((e: any) => e.kind === 'narrate_complete');
  console.log(`narrate_delta events: ${narrateDeltas.length}`);
  console.log(`narrate_complete events: ${narrateCompletes.length}`);
  const toolArgsCompletes = allEvents.filter((e: any) => e.kind === 'tool_args_complete');
  console.log(`tool_args_complete events: ${toolArgsCompletes.length}`);
}

main();
