/**
 * Smoke tests for TaskAgent. v0.2.0 · Wave 2·B.
 *
 *   pnpm tsx src/agent/task/task.test.ts
 *
 * Covers:
 *   - empty / whitespace ask resolves to ''
 *   - tool-less ask returns the LLM's final text and appends turns
 *     to the session
 *   - tool-call loop runs the host's tool, feeds the result back,
 *     produces a final reply
 *   - register / unregister tools live
 *   - shared session: two agents append to same Session.turns[]
 *   - maxToolRounds caps the loop
 */

import { TaskAgent } from './index';
import type { LLMProvider, CompleteOptions, CompleteResult } from '../llm/types';
import type { AgentSession } from '../webagent/types';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

/**
 * Scripted LLM stub — emits the next queued response on each
 * `complete()` call. Lets us script multi-round tool-call sequences
 * deterministically.
 */
function scriptedLlm(script: CompleteResult[]): { provider: LLMProvider; calls: CompleteOptions[] } {
  const calls: CompleteOptions[] = [];
  let idx = 0;
  const provider: LLMProvider = {
    name: 'scripted',
    complete: async (opts: CompleteOptions): Promise<CompleteResult> => {
      calls.push(opts);
      const next = script[idx++];
      if (!next) {
        return { content: '', finishReason: 'stop' };
      }
      return next;
    },
  };
  return { provider, calls };
}

// ─── basic ────────────────────────────────────────────────────

console.log('TaskAgent basic:');

{
  const { provider } = scriptedLlm([{ content: '', finishReason: 'stop' }]);
  const agent = new TaskAgent({ llm: provider, systemPrompt: '...' });
  const reply = await agent.ask('');
  check('empty ask returns ""', reply === '');
}

{
  const { provider, calls } = scriptedLlm([
    { content: 'Hello there.', finishReason: 'stop' },
  ]);
  const agent = new TaskAgent({ llm: provider, systemPrompt: 'be friendly' });
  const reply = await agent.ask('hi');
  check('tool-less ask returns final text',     reply === 'Hello there.');
  check('LLM saw the system prompt',            calls[0]?.messages?.[0]?.content === 'be friendly');
  check('LLM saw the user task',                calls[0]?.messages?.[1]?.content === 'hi');
  const session = agent.getSession();
  check('session has the user turn appended',   session.turns.some((t) => t.kind === 'user' && t.text === 'hi'));
  check('session has the assistant turn',       session.turns.some((t) => t.kind === 'agent_final'));
}

// ─── tool loop ───────────────────────────────────────────────

console.log('tool loop:');

{
  const { provider, calls } = scriptedLlm([
    // Round 1: LLM asks for the tool.
    {
      content: '',
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'c1', name: 'lookup_order', arguments: { id: '12345' } }],
    },
    // Round 2: LLM gives the final answer using the tool result.
    { content: 'Order #12345 ships tomorrow.', finishReason: 'stop' },
  ]);
  let handlerSawArgs: Record<string, unknown> | null = null;
  const agent = new TaskAgent({
    llm: provider,
    systemPrompt: 'support',
    tools: [{
      name: 'lookup_order',
      description: 'order status',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (args: any) => { handlerSawArgs = args; return { status: 'shipping' }; },
    }],
  });
  const reply = await agent.ask('Where is my order #12345?');
  check('tool-call loop returns final text',          reply === 'Order #12345 ships tomorrow.');
  check('handler received the args',                  handlerSawArgs !== null
    && (handlerSawArgs as { id: string }).id === '12345');
  check('second LLM call saw the tool result',        (calls[1]?.messages ?? []).some((m) =>
    m.role === 'tool' && typeof m.content === 'string' && m.content.includes('shipping')));
}

// ─── registry ─────────────────────────────────────────────────

console.log('tool registry:');

{
  const { provider } = scriptedLlm([{ content: '', finishReason: 'stop' }]);
  const agent = new TaskAgent({ llm: provider, systemPrompt: '...' });
  const handle = agent.registerTool({
    name: 'noop',
    description: 'no-op',
    parameters: { type: 'object', properties: {} },
    handler: () => ({ ok: true }),
  });
  check('registerTool returns handle',     typeof handle.remove === 'function');
  check('unregisterTool removes by name',  agent.unregisterTool('noop') === true);
  check('unregister returns false on miss', agent.unregisterTool('noop') === false);
}

// ─── shared session ──────────────────────────────────────────

console.log('shared session:');

{
  const session: AgentSession = {
    id: 'shared',
    turns: [],
    status: 'idle',
    currentPage: '/',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  const { provider: prov1 } = scriptedLlm([{ content: 'r1', finishReason: 'stop' }]);
  const { provider: prov2, calls: calls2 } = scriptedLlm([{ content: 'r2', finishReason: 'stop' }]);
  const a = new TaskAgent({ llm: prov1, systemPrompt: 'A', session });
  const b = new TaskAgent({ llm: prov2, systemPrompt: 'B', session });
  await a.ask('ask via A');
  await b.ask('ask via B');
  check('both agents reference the same session',  a.getSession() === b.getSession());
  check('session.turns has both asks',             session.turns.filter((t) => t.kind === 'user').length === 2);
  // Continuity: B's LLM call should have seen A's full exchange.
  const userMessagesSeenByB = (calls2[0]?.messages ?? []).filter((m) => m.role === 'user');
  check('agent B sees prior user turn from agent A', userMessagesSeenByB.some((m) => m.content === 'ask via A'));
  const assistantSeenByB = (calls2[0]?.messages ?? []).filter((m) => m.role === 'assistant');
  check('agent B sees prior assistant reply (text serialized)', assistantSeenByB.some((m) => m.content === 'r1'));
}

// ─── cross-type tolerance ────────────────────────────────────

console.log('cross-type session tolerance:');

{
  // Seed session with a WebAgent-shape agent_step turn that TaskAgent
  // doesn't know how to render. Serialization should SKIP it without
  // crashing or polluting the message stack.
  const session: AgentSession = {
    id: 'cross',
    turns: [
      { kind: 'user', ts: Date.now(), text: 'previously, via webagent' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { kind: 'agent_step', ts: Date.now(), toolCallId: 'x', toolCall: { name: 'click', arguments: {} }, result: { ok: true } } as any,
    ],
    status: 'idle',
    currentPage: '/',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  const { provider, calls } = scriptedLlm([{ content: 'ok', finishReason: 'stop' }]);
  const agent = new TaskAgent({ llm: provider, systemPrompt: 'x', session });
  await agent.ask('continue');
  const msgsRoles = (calls[0]?.messages ?? []).map((m) => m.role).join(',');
  check('agent_step turn is silently skipped',  !msgsRoles.includes('tool'));
  check('user turn from prior agent is preserved',
        (calls[0]?.messages ?? []).some((m) => m.role === 'user' && m.content === 'previously, via webagent'));
}

// ─── tool-rounds cap ──────────────────────────────────────────

console.log('tool-rounds cap:');

{
  // The LLM never returns a text-only reply — it keeps calling the
  // tool. The cap should fire and the loop should exit with the
  // partial content (here: empty string) without spinning forever.
  const repeat: CompleteResult = {
    content: '',
    finishReason: 'tool_calls',
    toolCalls: [{ id: 'c', name: 'noop', arguments: {} }],
  };
  const { provider, calls } = scriptedLlm([repeat, repeat, repeat, repeat, repeat, repeat]);
  const agent = new TaskAgent({
    llm: provider,
    systemPrompt: 'x',
    tools: [{
      name: 'noop',
      description: 'no-op',
      parameters: { type: 'object', properties: {} },
      handler: () => ({ ok: true }),
    }],
    maxToolRounds: 3,
  });
  const reply = await agent.ask('keep going');
  check('cap fires at maxToolRounds',     calls.length === 3);
  check('reply is empty on cap',          reply === '');
}

// ─── streamAsk (non-streaming fallback) ──────────────────────

console.log('streamAsk (non-streaming fallback):');

{
  const { provider } = scriptedLlm([{ content: 'streamed reply', finishReason: 'stop' }]);
  const agent = new TaskAgent({ llm: provider, systemPrompt: 'x' });
  const chunks: import('./types').TaskAgentStreamChunk[] = [];
  for await (const c of agent.streamAsk('hi')) chunks.push(c);
  check('streamAsk yields at least one chunk',         chunks.length >= 1);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  check('last chunk has done: true',                   chunks[chunks.length - 1]!.done === true);
  const finalText = chunks[chunks.length - 1]!.text;
  check('terminal chunk carries the full text',        finalText === 'streamed reply');
  check('session has agent_final with the text',
        agent.getSession().turns.some(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t) => t.kind === 'agent_final' && (t as any).text === 'streamed reply',
        ));
}

{
  // tool-call markers should bracket the tool execution
  const { provider } = scriptedLlm([
    { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 't1', name: 'lookup', arguments: {} }] },
    { content: 'done', finishReason: 'stop' },
  ]);
  const agent = new TaskAgent({
    llm: provider,
    systemPrompt: 'x',
    tools: [{
      name: 'lookup',
      description: 'noop',
      parameters: { type: 'object', properties: {} },
      handler: () => ({ ok: true }),
    }],
  });
  const chunks: import('./types').TaskAgentStreamChunk[] = [];
  for await (const c of agent.streamAsk('go')) chunks.push(c);
  const startCount = chunks.filter((c) => c.toolCallStart?.name === 'lookup').length;
  const endCount   = chunks.filter((c) => c.toolCallEnd?.name   === 'lookup').length;
  check('streamAsk emits one toolCallStart per call',   startCount === 1);
  check('streamAsk emits one toolCallEnd per call',     endCount === 1);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  check('streamAsk terminal chunk text is full reply', chunks[chunks.length - 1]!.text.endsWith('done'));
}

// ─── Summary ─────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
