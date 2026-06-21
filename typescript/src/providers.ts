import type { ChatOptions, NormalizedUsage, Provider, ProviderAdapter } from './types.js';

interface OpenAIChatClient {
  chat: { completions: { create: (args: unknown) => Promise<unknown> } };
}

interface AnthropicClient {
  messages: { create: (args: unknown) => Promise<unknown> };
}

interface GeminiClient {
  models: { generateContent: (args: unknown) => Promise<unknown> };
}

const openaiAdapter: ProviderAdapter<OpenAIChatClient, unknown> = {
  name: 'openai',
  matches(client: unknown): client is OpenAIChatClient {
    if (!isObject(client)) return false;
    const chat = (client as Record<string, unknown>).chat;
    if (!isObject(chat)) return false;
    const completions = (chat as Record<string, unknown>).completions;
    if (!isObject(completions)) return false;
    return typeof (completions as Record<string, unknown>).create === 'function';
  },
  async call(client, options) {
    if (options.stream === true) {
      throw new Error(
        'Weckr: stream:true is not supported by wk.chat() because token usage is not in stream responses by default. ' +
          'Either disable streaming, or call openai.chat.completions.create() directly outside wk.chat() (you lose cost tracking) ' +
          'and we will add proper streaming support in a future release.',
      );
    }
    const { userId, feature, plan, ...rest } = options;
    void userId; void feature; void plan;
    return client.chat.completions.create(rest);
  },
  extractUsage(result) {
    const r = result as { usage?: Record<string, unknown> } | undefined;
    const usage = (r?.usage ?? {}) as Record<string, unknown>;
    return {
      inputTokens: toInt(usage.prompt_tokens ?? usage.input_tokens),
      outputTokens: toInt(usage.completion_tokens ?? usage.output_tokens),
    };
  },
};

const anthropicAdapter: ProviderAdapter<AnthropicClient, unknown> = {
  name: 'anthropic',
  matches(client: unknown): client is AnthropicClient {
    if (!isObject(client)) return false;
    const messages = (client as Record<string, unknown>).messages;
    if (!isObject(messages)) return false;
    return typeof (messages as Record<string, unknown>).create === 'function';
  },
  async call(client, options) {
    const { userId, feature, plan, ...rest } = options;
    void userId; void feature; void plan;
    return client.messages.create(rest);
  },
  extractUsage(result) {
    const r = result as { usage?: Record<string, unknown> } | undefined;
    const usage = (r?.usage ?? {}) as Record<string, unknown>;
    return {
      inputTokens: toInt(usage.input_tokens),
      outputTokens: toInt(usage.output_tokens),
    };
  },
};

const geminiAdapter: ProviderAdapter<GeminiClient, unknown> = {
  name: 'gemini',
  matches(client: unknown): client is GeminiClient {
    if (!isObject(client)) return false;
    const models = (client as Record<string, unknown>).models;
    if (!isObject(models)) return false;
    return typeof (models as Record<string, unknown>).generateContent === 'function';
  },
  async call(client, options) {
    const { userId, feature, plan, messages, ...rest } = options;
    void userId; void feature; void plan;
    const contents = (messages ?? []).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }));
    return client.models.generateContent({ ...rest, contents });
  },
  extractUsage(result) {
    const r = result as { usageMetadata?: Record<string, unknown> } | undefined;
    const meta = (r?.usageMetadata ?? {}) as Record<string, unknown>;
    return {
      inputTokens: toInt(meta.promptTokenCount),
      outputTokens: toInt(meta.candidatesTokenCount),
    };
  },
};

const adapters: ProviderAdapter[] = [openaiAdapter, anthropicAdapter, geminiAdapter];

export function detectAdapter(client: unknown): ProviderAdapter | null {
  for (const adapter of adapters) {
    if (adapter.matches(client)) return adapter;
  }
  return null;
}

export function normalizeUsage(provider: Provider, result: unknown): NormalizedUsage {
  const adapter = adapters.find((a) => a.name === provider);
  if (!adapter) return { inputTokens: 0, outputTokens: 0 };
  return adapter.extractUsage(result);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toInt(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
