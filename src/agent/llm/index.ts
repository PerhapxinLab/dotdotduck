export { OpenAIProvider, type OpenAIProviderConfig } from './openai';
export { GoogleProvider, type GoogleProviderConfig } from './google';
export { ProxyProvider, type ProxyProviderConfig } from './proxy';

export { resolveLLM, isLLMRouter } from './router';
export type { LLMRouter, LLMSource, LLMRole as LLMRouterRole } from './router';

export { buildStream } from './stream';
export type { StreamChunk, StreamHandle, StreamingProvider } from './stream';
export type {
  LLMProvider,
  CompleteOptions,
  CompleteResult,
  LLMMessage,
  LLMRole,
  ContentPart,
  ToolDefinition,
  ToolCall,
} from './types';

// ─── Adapter registry (uniform façade) ─────────────────────────────
export {
  seedDefaultAdapters,
  registerAdapter,
  getAdapter,
  listAdapters,
  unregisterAdapter,
  createProvider,
  openaiAdapter,
  googleAdapter,
  proxyAdapter,
  agnesAdapter,
} from './adapters';
export type { LLMAdapter, AdapterConfig } from './adapters';
