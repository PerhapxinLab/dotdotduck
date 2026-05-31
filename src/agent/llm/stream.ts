/**
 * LLM streaming — dual-form return (Promise + AsyncIterable).
 *
 *   const reply = llm.streamComplete(opts);
 *   for await (const chunk of reply) {
 *     ui.append(chunk.delta);
 *   }
 *   const full = await reply;          // same object resolves to CompleteResult
 *
 * The provider implementation creates a single object that is both
 * awaitable (returns CompleteResult) and async-iterable (yields StreamChunk
 * per delta), so each provider only writes its SSE parsing once.
 */

import type { CompleteResult, ToolCall } from './types';

export interface StreamChunk {
  /** Incremental text delta since previous chunk. */
  delta: string;
  /** Snapshot of accumulated text so far. */
  text: string;
  /** Tool calls assembled so far. */
  toolCalls?: ToolCall[];
  /** True only on the very last chunk. */
  done: boolean;
  /** Reason for stop — present on the final chunk only. */
  finishReason?: CompleteResult['finishReason'];
  /**
   * Set on the terminal chunk when streaming aborted with an error. The
   * `await handle` form will reject with the same error; iterators receive
   * the chunk so callers iterating without awaiting can still observe it.
   */
  error?: unknown;
}

/**
 * Combined awaitable + async-iterable handle.
 *   const r = streamComplete(...);
 *   for await (const c of r) {}
 *   const result = await r;
 */
export type StreamHandle = AsyncIterable<StreamChunk> & Promise<CompleteResult>;

interface BuildStreamOptions {
  /**
   * Produces a stream of deltas. Implementation is provider-specific (parses
   * SSE, decodes Gemini chunks, whatever). Each yield is a string delta;
   * pass `null` to signal completion with optional final result.
   */
  produce(): AsyncIterable<{ delta?: string; toolCall?: ToolCall; finishReason?: CompleteResult['finishReason']; usage?: CompleteResult['usage'] }>;
}

/**
 * Build a StreamHandle from a provider's chunk producer.
 * Buffers a single iteration so the awaited Promise and the iterable share state.
 */
export function buildStream(opts: BuildStreamOptions): StreamHandle {
  let text = '';
  const toolCalls: ToolCall[] = [];
  let finishReason: CompleteResult['finishReason'] | undefined;
  let usage: CompleteResult['usage'] | undefined;
  const buffered: StreamChunk[] = [];
  let waiters: Array<(c: StreamChunk | null) => void> = [];
  let done = false;
  let pendingError: unknown;
  // TTFT instrumentation. `startedAt` is sampled at buildStream() return,
  // which is the moment the host issued the call. `firstDeltaAt` is the
  // first non-empty text delta — TTFT = firstDeltaAt − startedAt.
  const startedAt = Date.now();
  let firstDeltaAt: number | undefined;
  let endedAt = startedAt;

  // Drive the producer in the background.
  let producerErrored = false;
  (async () => {
    try {
      for await (const evt of opts.produce()) {
        if (evt.toolCall) {
          // Merge / append tool call (could be partial fragments)
          const existing = toolCalls.find((t) => t.id === evt.toolCall!.id);
          if (existing) {
            // accumulate arguments
            existing.arguments = { ...existing.arguments, ...evt.toolCall.arguments };
          } else {
            toolCalls.push(evt.toolCall);
          }
        }
        if (evt.delta !== undefined) {
          if (evt.delta.length > 0 && firstDeltaAt === undefined) {
            firstDeltaAt = Date.now();
          }
          text += evt.delta;
        }
        if (evt.usage) usage = evt.usage;
        if (evt.finishReason) finishReason = evt.finishReason;
        endedAt = Date.now();

        const chunk: StreamChunk = {
          delta: evt.delta ?? '',
          text,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          done: false,
        };
        if (waiters.length > 0) {
          const w = waiters.shift()!;
          w(chunk);
        } else {
          buffered.push(chunk);
        }
      }
    } catch (err) {
      // Don't pretend success: emit a terminal chunk carrying the error so
      // iterators see it, AND store the error so the awaited Promise form
      // rejects.
      producerErrored = true;
      pendingError = err;
      const errChunk: StreamChunk = {
        delta: '',
        text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        done: true,
        // No finishReason — caller can branch on `error` field instead.
        error: err,
      };
      if (waiters.length > 0) {
        const w = waiters.shift()!;
        w(errChunk);
      } else {
        buffered.push(errChunk);
      }
      // Wake any remaining waiters with end-of-stream
      for (const w of waiters) w(null);
      waiters = [];
      done = true;
    } finally {
      if (!producerErrored) {
        const final: StreamChunk = {
          delta: '',
          text,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          done: true,
          finishReason: finishReason ?? 'stop',
        };
        if (waiters.length > 0) {
          const w = waiters.shift()!;
          w(final);
        } else {
          buffered.push(final);
        }
        for (const w of waiters) w(null);
        waiters = [];
        done = true;
      }
    }
  })();

  // Build the iterator.
  const iterator: AsyncIterator<StreamChunk> = {
    next(): Promise<IteratorResult<StreamChunk>> {
      if (buffered.length > 0) {
        const c = buffered.shift()!;
        return Promise.resolve({ value: c, done: c.done && !buffered.length });
      }
      if (done) {
        return Promise.resolve({ value: undefined as never, done: true });
      }
      return new Promise<IteratorResult<StreamChunk>>((resolve) => {
        waiters.push((c) => {
          if (!c) resolve({ value: undefined as never, done: true });
          else resolve({ value: c, done: c.done && !buffered.length });
        });
      });
    },
  };

  // Awaitable resolution — drains iterator then resolves with CompleteResult.
  const awaitable = (async (): Promise<CompleteResult> => {
    for await (const _ of {
      [Symbol.asyncIterator]() {
        return iterator;
      },
    }) {
      // drain
    }
    if (pendingError) throw pendingError;
    return {
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason: finishReason ?? 'stop',
      streamMetrics: { startedAt, firstDeltaAt, endedAt },
    };
  })();

  // The dual handle — looks like a Promise AND an AsyncIterable.
  const handle = awaitable as StreamHandle;
  (handle as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<StreamChunk> })[
    Symbol.asyncIterator
  ] = () => iterator;
  return handle;
}

/**
 * Provider interface extension — providers MAY implement streamComplete in
 * addition to the base complete(). Callers should feature-check.
 */
export interface StreamingProvider {
  streamComplete?(opts: import('./types').CompleteOptions): StreamHandle;
}
