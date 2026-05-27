/**
 * Gemini SSE stream parser. Used by GoogleProvider.streamComplete.
 */

import type { CompleteOptions } from '../types';
import { toGeminiMessages, mapFinishReason } from './transform';
import { redactSecrets } from '../../../utils/redact';

export const THINKING_BUDGET: Record<NonNullable<CompleteOptions['thinking']>, number> = {
  off: 0,
  minimal: 64,
  low: 512,
  medium: 1024,
  high: 4096,
};

/**
 * Per-family thinkingConfig builder — per official 2026-05 Google docs:
 *   https://ai.google.dev/gemini-api/docs/thinking
 *
 *   - Gemini 3.x / Gemma 4 → `thinkingLevel`: "minimal"|"low"|"medium"|"high"
 *   - Gemini 2.5           → `thinkingBudget`: int (0–32768, -1=dynamic)
 *
 * Sending the wrong field returns HTTP 400 ("Thinking budget is not
 * supported for this model").
 *
 * On Gemma 4, `includeThoughts: false` is silently ignored — the only
 * effective lever is `thinkingLevel`, and a response-side filter strips
 * `thought:true` parts as defense.
 *
 * When the caller doesn't pass `opts.thinking` we omit `thinkingConfig`
 * entirely; the model uses its dynamic default. Short / JSON tasks
 * should pass `thinking: 'off'` to avoid `maxOutputTokens` truncation.
 *
 * Returns `null` when nothing should be sent.
 */
const GEMMA_THINKING_LEVEL: Record<NonNullable<CompleteOptions['thinking']>, string> = {
  off: 'minimal',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

export function buildThinkingConfig(
  model: string,
  thinking: CompleteOptions['thinking'] | undefined,
): Record<string, unknown> | null {
  if (!thinking) return null;
  const m = model.toLowerCase();
  // Gemini 3.x and Gemma 4 take thinkingLevel. Other Gemini families (2.5)
  // take thinkingBudget. We can't reliably detect "Gemini 3.x" by prefix
  // because the line includes pro/flash/flash-lite preview variants, so
  // default to thinkingBudget unless we know it's a thinkingLevel family.
  if (m.startsWith('gemma-') || /^gemini-3(\.|-|$)/.test(m)) {
    return { thinkingLevel: GEMMA_THINKING_LEVEL[thinking] };
  }
  return { thinkingBudget: THINKING_BUDGET[thinking] };
}

export async function* streamGemini(args: {
  apiKey: string;
  model: string;
  baseURL: string;
  opts: CompleteOptions;
}) {
  // Key goes in a header, not the URL.
  const url = `${args.baseURL}/models/${args.model}:streamGenerateContent?alt=sse`;

  const { contents, systemInstruction } = toGeminiMessages(args.opts.messages);
  const generationConfig: Record<string, unknown> = {
    temperature: args.opts.temperature ?? 0.7,
    maxOutputTokens: args.opts.maxTokens,
  };
  // Thinking config — see buildThinkingConfig docstring for the per-family
  // field mapping. No auto-default: caller controls the level.
  const thinkingPayload = buildThinkingConfig(args.model, args.opts.thinking);
  if (thinkingPayload) generationConfig.thinkingConfig = thinkingPayload;
  if (args.opts.jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }
  const body: Record<string, unknown> = {
    contents,
    generationConfig,
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (args.opts.tools && args.opts.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: args.opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': args.apiKey,
    },
    body: JSON.stringify(body),
    signal: args.opts.signal,
  });

  if (!response.ok || !response.body) {
    const txt = await response.text().catch(() => response.statusText);
    throw new Error(
      `Gemini stream HTTP ${response.status}: ${redactSecrets(txt, [args.apiKey])}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    let done = false;
    let value: Uint8Array | undefined;
    try {
      const r = await reader.read();
      done = r.done;
      value = r.value;
    } catch (err) {
      // User aborted the stream — surface as a clean exit so the loop
      // can wind down without an unhandled rejection.
      if ((err as Error).name === 'AbortError') return;
      throw err;
    }
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;

      let parsed: {
        candidates?: Array<{
          content?: {
            parts: Array<{
              text?: string;
              thought?: boolean;
              functionCall?: { name: string; args?: unknown };
            }>;
          };
          finishReason?: string;
        }>;
        usageMetadata?: {
          promptTokenCount: number;
          candidatesTokenCount: number;
          totalTokenCount: number;
        };
      };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      const cand = parsed.candidates?.[0];
      if (!cand) continue;

      for (const part of cand.content?.parts ?? []) {
        // Skip Gemma 4 thought parts — they pollute the streaming buffer
        // and corrupt JSON output for downstream consumers (immersive
        // translate, structured tool calling, etc.).
        if (part.thought === true) continue;
        if (part.text) {
          yield { delta: part.text };
        }
        if (part.functionCall) {
          yield {
            toolCall: {
              id: `gem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: part.functionCall.name,
              arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
            },
          };
        }
      }
      if (cand.finishReason) {
        yield {
          finishReason: mapFinishReason(cand.finishReason),
          usage: parsed.usageMetadata
            ? {
                promptTokens: parsed.usageMetadata.promptTokenCount,
                completionTokens: parsed.usageMetadata.candidatesTokenCount,
              }
            : undefined,
        };
      }
    }
  }
}
