import type { LogPayload } from './types.js';

export interface LoggerOptions {
  apiKey: string;
  endpoint: string;
  fetch?: typeof fetch;
  onError?: (err: unknown) => void;
  /**
   * Max events held for retry when the network or Weckr is unavailable.
   * Oldest events are dropped first once full. Default 500, roughly 100KB.
   * Set 0 to disable retries entirely (previous behaviour).
   */
  maxBufferedEvents?: number;
}

export interface Logger {
  log(payload: LogPayload): void;
  /** Await all in-flight POSTs. Call before process.exit() in short-lived scripts. */
  flush(timeoutMs?: number): Promise<void>;
  /** Events currently waiting on a retry. Exposed for tests and diagnostics. */
  pending(): number;
}

/** Retry schedule in ms. Short enough to recover from a blip, bounded so a
 *  long outage does not keep a process alive or hammer a struggling server. */
const BACKOFF_MS = [1_000, 5_000, 20_000];

/**
 * Retryable means "the event might still land if we try again": network
 * failures, timeouts, 5xx, and 429. A 4xx other than 429 is a permanent
 * rejection (bad key, malformed payload, over plan limit) and retrying it
 * would just burn requests.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createLogger(opts: LoggerOptions): Logger {
  // NB: we defer the fetch check until first log() — `createLogger` shouldn't
  // fail app boot just because a non-Node runtime didn't expose global fetch.
  const inflight = new Set<Promise<unknown>>();
  const maxBuffered = opts.maxBufferedEvents ?? 500;

  // Events awaiting a retry, oldest first. Bounded: a long outage drops the
  // oldest events rather than growing without limit, because an unbounded
  // buffer in a customer's process is a worse failure than a missing row.
  const buffer: { payload: LogPayload; attempt: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function scheduleDrain(delayMs: number): void {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      drain();
    }, delayMs);
    // Never hold a Node process open just to retry telemetry.
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  function drain(): void {
    const batch = buffer.splice(0, buffer.length);
    for (const item of batch) send(item.payload, item.attempt);
  }

  function enqueue(payload: LogPayload, attempt: number): void {
    if (maxBuffered <= 0) return;
    if (attempt >= BACKOFF_MS.length) {
      opts.onError?.(new Error('Weckr: dropping event after final retry attempt.'));
      return;
    }
    if (buffer.length >= maxBuffered) {
      buffer.shift();
      opts.onError?.(new Error('Weckr: retry buffer full, oldest event dropped.'));
    }
    buffer.push({ payload, attempt });
    scheduleDrain(BACKOFF_MS[attempt]!);
  }

  function send(payload: LogPayload, attempt: number): void {
    const f = opts.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') {
      opts.onError?.(
        new Error('Weckr: global fetch is unavailable. Pass a fetch implementation via config.fetch.'),
      );
      return;
    }
    let promise: Promise<Response>;
    try {
      promise = f(opts.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (err) {
      opts.onError?.(err);
      enqueue(payload, attempt + 1);
      return;
    }
    const tracked = promise
      .then(async (res) => {
        if (res.ok) return;
        const body = await res.text().catch(() => '');
        opts.onError?.(
          new Error(
            `Weckr log failed: ${res.status} ${res.statusText} ${body}. ` +
              (res.status === 401 || res.status === 403
                ? `Verify the api key at https://app.useweckr.com/dashboard/settings.`
                : ''),
          ),
        );
        // The event is idempotent on eventId server-side, so a retry that
        // races a slow success is deduped rather than double counted.
        if (isRetryableStatus(res.status)) enqueue(payload, attempt + 1);
      })
      .catch((err) => {
        opts.onError?.(err);
        enqueue(payload, attempt + 1);
      })
      .finally(() => {
        inflight.delete(tracked);
      });
    inflight.add(tracked);
  }

  function log(payload: LogPayload): void {
    queueMicrotask(() => send(payload, 0));
  }

  async function flush(timeoutMs = 5000): Promise<void> {
    // Retry anything waiting rather than let a process exit drop it.
    if (buffer.length > 0) {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      drain();
    }
    if (inflight.size === 0) return;
    const all = Promise.allSettled(Array.from(inflight));
    if (timeoutMs <= 0) {
      await all;
      return;
    }
    let t: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      t = setTimeout(() => resolve(), timeoutMs);
    });
    await Promise.race([all, timeout]);
    if (t) clearTimeout(t);
  }

  return { log, flush, pending: () => buffer.length };
}
