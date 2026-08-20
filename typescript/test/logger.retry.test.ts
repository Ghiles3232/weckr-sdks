import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/logger.js';
import type { LogPayload } from '../src/types.js';

const payload = (id: string): LogPayload => ({
  userId: 'u_1',
  feature: 'chat',
  model: 'gpt-5.4-mini',
  provider: 'openai',
  inputTokens: 10,
  outputTokens: 20,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.001,
  latencyMs: 120,
  planName: 'pro',
  planRevenueUsd: 29,
  marginUsd: null,
  timestamp: new Date(0).toISOString(),
  eventId: id,
});

const ok = () => Promise.resolve(new Response('', { status: 200 }));
const status = (code: number) => () => Promise.resolve(new Response('', { status: code }));

describe('logger retry buffering', () => {
  it('does not retry a permanent rejection (401)', async () => {
    const fetchMock = vi.fn(status(401));
    const log = createLogger({ apiKey: 'wk_x', endpoint: 'https://e', fetch: fetchMock as never, onError: () => {} });
    log.log(payload('a'));
    await log.flush(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log.pending()).toBe(0);
  });

  it('buffers a retryable failure (503) instead of dropping it', async () => {
    const fetchMock = vi.fn(status(503));
    const log = createLogger({ apiKey: 'wk_x', endpoint: 'https://e', fetch: fetchMock as never, onError: () => {} });
    log.log(payload('b'));
    await new Promise((r) => setTimeout(r, 20));
    expect(log.pending()).toBe(1);
  });

  it('flush() retries buffered events and they can succeed', async () => {
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      return calls === 1 ? status(503)() : ok();
    });
    const log = createLogger({ apiKey: 'wk_x', endpoint: 'https://e', fetch: fetchMock as never, onError: () => {} });
    log.log(payload('c'));
    await new Promise((r) => setTimeout(r, 20));
    expect(log.pending()).toBe(1);
    await log.flush(200);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(log.pending()).toBe(0);
  });

  it('respects maxBufferedEvents and never grows unbounded', async () => {
    const fetchMock = vi.fn(status(503));
    const log = createLogger({
      apiKey: 'wk_x',
      endpoint: 'https://e',
      fetch: fetchMock as never,
      onError: () => {},
      maxBufferedEvents: 2,
    });
    for (let i = 0; i < 10; i++) log.log(payload(`d${i}`));
    await new Promise((r) => setTimeout(r, 30));
    expect(log.pending()).toBeLessThanOrEqual(2);
  });

  it('maxBufferedEvents: 0 keeps the old fire-and-forget behaviour', async () => {
    const fetchMock = vi.fn(status(503));
    const log = createLogger({
      apiKey: 'wk_x',
      endpoint: 'https://e',
      fetch: fetchMock as never,
      onError: () => {},
      maxBufferedEvents: 0,
    });
    log.log(payload('e'));
    await new Promise((r) => setTimeout(r, 20));
    expect(log.pending()).toBe(0);
  });
});
