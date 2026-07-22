import { describe, it, expect, vi } from 'vitest';
import { Weckr } from '../src/weckr.js';
import { calculateCost, resolvePricing } from '../src/pricing.js';
import { detectAdapter, normalizeUsage } from '../src/providers.js';

// A realistic Moonshot (Kimi) chat completion. Moonshot is OpenAI compatible,
// so the shape matches an OpenAI chat.completions response.
const KIMI_RESPONSE = {
  id: 'chatcmpl-abc123',
  object: 'chat.completion',
  created: 1730000000,
  model: 'kimi-k2.6',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'Hello from Kimi.' }, finish_reason: 'stop' },
  ],
  usage: {
    prompt_tokens: 1200,
    completion_tokens: 300,
    total_tokens: 1500,
    prompt_tokens_details: { cached_tokens: 400 },
  },
};

function moonshotClient(
  create: unknown = vi.fn().mockResolvedValue(KIMI_RESPONSE),
  baseURL = 'https://api.moonshot.ai/v1',
) {
  return { baseURL, chat: { completions: { create } } };
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('Kimi: response parsing', () => {
  it('extracts input, output, and cached tokens from a realistic Kimi response', () => {
    expect(normalizeUsage('kimi', KIMI_RESPONSE)).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cachedInputTokens: 400,
      cacheCreationTokens: 0,
    });
  });
});

describe('Kimi: cost calculation (hand-calculated)', () => {
  it('kimi-k2.6 with cache: 800*0.95 + 400*0.16 + 300*4 per 1M = 0.002024', () => {
    const { costUsd, provider } = calculateCost('kimi-k2.6', 1200, 300, 400);
    expect(provider).toBe('kimi');
    expect(costUsd).toBeCloseTo(0.002024, 9);
  });

  it('kimi-k3 at 3/15: 1M in + 1M out = 18.0', () => {
    expect(calculateCost('kimi-k3', 1_000_000, 1_000_000).costUsd).toBeCloseTo(18, 6);
  });

  it('kimi-k2.5 and kimi-k2 at 0.6/3.0: 1M + 1M = 3.6', () => {
    expect(calculateCost('kimi-k2.5', 1_000_000, 1_000_000).costUsd).toBeCloseTo(3.6, 6);
    expect(calculateCost('kimi-k2', 1_000_000, 1_000_000).costUsd).toBeCloseTo(3.6, 6);
  });

  it('dated variant kimi-k2.6-0930 resolves to kimi-k2.6, not kimi-k2', () => {
    expect(resolvePricing('kimi-k2.6-0930')?.inputPerMillion).toBe(0.95);
  });
});

describe('Kimi: provider detection (several client configs)', () => {
  it('api.moonshot.ai resolves to kimi', () => {
    expect(detectAdapter(moonshotClient())?.name).toBe('kimi');
  });

  it('api.moonshot.cn resolves to kimi', () => {
    expect(detectAdapter(moonshotClient(vi.fn(), 'https://api.moonshot.cn/v1'))?.name).toBe('kimi');
  });

  it('a URL-object style baseURL resolves to kimi', () => {
    const client = {
      baseURL: { href: 'https://api.moonshot.ai/v1' },
      chat: { completions: { create: vi.fn() } },
    };
    expect(detectAdapter(client)?.name).toBe('kimi');
  });

  it('a real OpenAI client (api.openai.com) resolves to openai, NOT kimi', () => {
    expect(detectAdapter(moonshotClient(vi.fn(), 'https://api.openai.com/v1'))?.name).toBe('openai');
  });

  it('an OpenAI client with no baseURL resolves to openai', () => {
    expect(detectAdapter({ chat: { completions: { create: vi.fn() } } })?.name).toBe('openai');
  });

  it('Anthropic and Gemini clients are unaffected by the Kimi adapter', () => {
    expect(detectAdapter({ messages: { create: vi.fn() } })?.name).toBe('anthropic');
    expect(detectAdapter({ models: { generateContent: vi.fn() } })?.name).toBe('gemini');
  });
});

describe('Kimi: end-to-end through wk.chat', () => {
  it('logs provider=kimi with correct tokens + cost and returns the result unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const wk = new Weckr({
      apiKey: 'wk_test',
      plans: { pro: 29 },
      fetch: fetchMock as unknown as typeof fetch,
      disableCapCheck: true,
    });
    const create = vi.fn().mockResolvedValue(KIMI_RESPONSE);

    const result = await wk.chat(moonshotClient(create), {
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'hi' }],
      userId: 'u1',
      feature: 'summary',
      plan: 'pro',
    });

    expect(result).toBe(KIMI_RESPONSE);
    expect(create).toHaveBeenCalledOnce();
    await flush();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.provider).toBe('kimi');
    expect(body.model).toBe('kimi-k2.6');
    expect(body.inputTokens).toBe(1200);
    expect(body.outputTokens).toBe(300);
    expect(body.cachedInputTokens).toBe(400);
    expect(body.costUsd).toBeCloseTo(0.002024, 9);
  });
});

describe('Kimi: fail-open when Weckr logging fails', () => {
  it('returns the Kimi result and does not throw when the log POST rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('weckr log endpoint down'));
    const onError = vi.fn();
    const wk = new Weckr({
      apiKey: 'wk_test',
      fetch: fetchMock as unknown as typeof fetch,
      disableCapCheck: true,
      onError,
    });
    const create = vi.fn().mockResolvedValue(KIMI_RESPONSE);

    const result = await wk.chat(moonshotClient(create), {
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result).toBe(KIMI_RESPONSE); // real LLM response returned unmodified
    expect(create).toHaveBeenCalledOnce(); // the actual call still happened
    await flush();
    expect(onError).toHaveBeenCalled(); // failure surfaced to onError, never thrown
  });
});
