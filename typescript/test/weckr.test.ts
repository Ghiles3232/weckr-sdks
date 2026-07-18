import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Weckr } from '../src/weckr.js';
import { calculateCost, resolvePricing } from '../src/pricing.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('pricing', () => {
  it('looks up exact model', () => {
    expect(resolvePricing('gpt-4o')?.provider).toBe('openai');
    expect(resolvePricing('claude-sonnet-4')?.provider).toBe('anthropic');
    expect(resolvePricing('gemini-2.5-pro')?.provider).toBe('gemini');
  });

  it('calculates cost in USD', () => {
    const { costUsd } = calculateCost('gpt-4o', 1_000_000, 1_000_000);
    expect(costUsd).toBeCloseTo(12.5, 4);
  });

  it('returns 0 for unknown models', () => {
    const { costUsd, provider } = calculateCost('unknown-model', 100, 100);
    expect(costUsd).toBe(0);
    expect(provider).toBeNull();
  });
});

describe('Weckr.chat', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let wk: Weckr;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    wk = new Weckr({
      apiKey: 'wk_test',
      plans: { free: 0, pro: 29 },
      fetch: fetchMock as unknown as typeof fetch,
      disableCapCheck: true,
    });
  });

  it('wraps an OpenAI-shaped client and returns the original result', async () => {
    const openaiResult = {
      id: 'chatcmpl-1',
      choices: [{ message: { role: 'assistant', content: 'hi' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
    const client = {
      chat: { completions: { create: vi.fn().mockResolvedValue(openaiResult) } },
    };

    const result = await wk.chat(client, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      userId: 'u1',
      feature: 'summary',
      plan: 'pro',
    });

    expect(result).toBe(openaiResult);
    expect(client.chat.completions.create).toHaveBeenCalledOnce();
    const callArg = client.chat.completions.create.mock.calls[0]![0];
    expect(callArg).not.toHaveProperty('userId');
    expect(callArg).not.toHaveProperty('feature');
    expect(callArg).not.toHaveProperty('plan');
  });

  it('does not block the caller while logging', async () => {
    const slow = deferred<Response>();
    fetchMock.mockReturnValueOnce(slow.promise);

    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        },
      },
    };

    const start = Date.now();
    await wk.chat(client, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      plan: 'pro',
    });
    expect(Date.now() - start).toBeLessThan(50);

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledOnce();
    slow.resolve(new Response(null, { status: 202 }));
  });

  it('logs cost, margin, latency, and provider', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            usage: { prompt_tokens: 1000, completion_tokens: 500 },
          }),
        },
      },
    };

    await wk.chat(client, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      userId: 'u1',
      feature: 'summary',
      plan: 'pro',
    });

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/v1/log');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'wk_test' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      userId: 'u1',
      feature: 'summary',
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 1000,
      outputTokens: 500,
      planName: 'pro',
      planRevenueUsd: 29,
    });
    // cost: 1000 * 2.5/1M + 500 * 10/1M = 0.0025 + 0.005 = 0.0075
    expect(body.costUsd).toBeCloseTo(0.0075, 6);
    expect(body.marginUsd).toBeCloseTo(28.99, 2);
    expect(typeof body.latencyMs).toBe('number');
    expect(body.timestamp).toMatch(/T.*Z$/);
  });

  it('swallows logger errors without affecting the result', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const onError = vi.fn();
    const wk2 = new Weckr({
      apiKey: 'wk_test',
      fetch: fetchMock as unknown as typeof fetch,
      onError,
    });
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        },
      },
    };
    const result = await wk2.chat(client, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(result).toBeDefined();
    await flushMicrotasks();
    expect(onError).toHaveBeenCalled();
  });

  it('normalizes Anthropic usage', async () => {
    const client = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValue({ usage: { input_tokens: 200, output_tokens: 100 } }),
      },
    };
    await wk.chat(client, {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'x' }],
    });
    await flushMicrotasks();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.provider).toBe('anthropic');
    expect(body.inputTokens).toBe(200);
    expect(body.outputTokens).toBe(100);
  });

  it('normalizes Gemini usage', async () => {
    const client = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 150 },
        }),
      },
    };
    await wk.chat(client, {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'x' }],
    });
    await flushMicrotasks();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.provider).toBe('gemini');
    expect(body.inputTokens).toBe(300);
    expect(body.outputTokens).toBe(150);
  });

  it('captures OpenAI cached tokens and prices them at the cached rate', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 500,
              prompt_tokens_details: { cached_tokens: 600 },
            },
          }),
        },
      },
    };
    await wk.chat(client, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      plan: 'pro',
    });
    await flushMicrotasks();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.inputTokens).toBe(1000);
    expect(body.cachedInputTokens).toBe(600);
    expect(body.cacheCreationTokens).toBe(0);
    // 400*2.5/1M + 600*1.25/1M + 500*10/1M = 0.001 + 0.00075 + 0.005 = 0.00675
    expect(body.costUsd).toBeCloseTo(0.00675, 6);
  });

  it('folds Anthropic cache_read into inputTokens and captures cache writes', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          usage: {
            input_tokens: 400,
            output_tokens: 200,
            cache_read_input_tokens: 600,
            cache_creation_input_tokens: 300,
          },
        }),
      },
    };
    await wk.chat(client, {
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'x' }],
    });
    await flushMicrotasks();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.inputTokens).toBe(1000); // 400 uncached + 600 cache-read folded in
    expect(body.cachedInputTokens).toBe(600);
    expect(body.cacheCreationTokens).toBe(300);
    // 400*3/1M + 600*0.3/1M + 300*3.75/1M + 200*15/1M = 0.005505
    expect(body.costUsd).toBeCloseTo(0.005505, 6);
  });

  it('throws when the client shape is unknown', async () => {
    await expect(
      wk.chat({} as any, { model: 'gpt-4o', messages: [] })
    ).rejects.toThrow(/could not detect provider/);
  });
});
