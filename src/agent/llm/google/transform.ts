/**
 * Conversion between our generic LLM shape and Gemini's wire shape.
 */

import type { LLMMessage, CompleteResult } from '../types';

export function toGeminiMessages(messages: LLMMessage[]): {
  contents: Array<Record<string, unknown>>;
  systemInstruction?: Record<string, unknown>;
} {
  const contents: Array<Record<string, unknown>> = [];
  let systemText = '';

  for (const m of messages) {
    if (m.role === 'system') {
      systemText += (typeof m.content === 'string' ? m.content : '') + '\n';
      continue;
    }

    const role = m.role === 'assistant' ? 'model' : 'user';

    if (m.toolCalls && m.toolCalls.length > 0) {
      const parts: Array<Record<string, unknown>> = [];
      // Preserve any assistant text accompanying the tool calls — some models
      // emit a thought / preamble alongside the call.
      if (typeof m.content === 'string' && m.content.length > 0) {
        parts.push({ text: m.content });
      }
      for (const tc of m.toolCalls) {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
      }
      contents.push({ role: 'model', parts });
      continue;
    }

    if (m.role === 'tool') {
      // Gemini's functionResponse.name pairs with the call's name (Gemini
      // doesn't track tool_call_ids the way OpenAI does). Prefer toolCallId
      // when supplied so router-shaped messages still round-trip.
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.toolCallId ?? m.name ?? 'unknown',
              response: { content: typeof m.content === 'string' ? m.content : '' },
            },
          },
        ],
      });
      continue;
    }

    const parts =
      typeof m.content === 'string'
        ? [{ text: m.content }]
        : m.content.map((p) =>
            p.type === 'text'
              ? { text: p.text }
              : { inlineData: { mimeType: 'image/png', data: stripDataPrefix(p.image) } },
          );
    contents.push({ role, parts });
  }

  return {
    contents,
    systemInstruction: systemText.trim()
      ? { parts: [{ text: systemText.trim() }] }
      : undefined,
  };
}

function stripDataPrefix(s: string): string {
  const idx = s.indexOf('base64,');
  return idx >= 0 ? s.slice(idx + 7) : s;
}

export function mapFinishReason(r?: string): CompleteResult['finishReason'] {
  switch (r) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
      return 'content_filter';
    default:
      return 'stop';
  }
}
