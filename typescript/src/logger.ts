import type { LogPayload } from './types.js';

export interface LoggerOptions {
  apiKey: string;
  endpoint: string;
  fetch?: typeof fetch;
  onError?: (err: unknown) => void;
}

export interface Logger {
  log(payload: LogPayload): void;
  /** Await all in-flight POSTs. Call before process.exit() in short-lived scripts. */
  flush(timeoutMs?: number): Promise<void>;
}

export function createLogger(opts: LoggerOptions): Logger {
  // NB: we defer the fetch check until first log() — `createLogger` shouldn't
  // fail app boot just because a non-Node runtime didn't expose global fetch.
  const inflight = new Set<Promise<unknown>>();

  function log(payload: LogPayload): void {
    const f = opts.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') {
      opts.onError?.(
        new Error('Weckr: global fetch is unavailable. Pass a fetch implementation via config.fetch.'),
      );
      return;
    }
    queueMicrotask(() => {
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
        return;
      }
      const tracked = promise
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            opts.onError?.(
              new Error(
                `Weckr log failed: ${res.status} ${res.statusText} ${body}. ` +
                  (res.status === 401 || res.status === 403
                    ? `Verify the api key at https://app.useweckr.com/dashboard/settings.`
                    : ''),
              ),
            );
          }
        })
        .catch((err) => {
          opts.onError?.(err);
        })
        .finally(() => {
          inflight.delete(tracked);
        });
      inflight.add(tracked);
    });
  }

  async function flush(timeoutMs = 5000): Promise<void> {
    if (inflight.size === 0) return;
    const all = Promise.allSettled(Array.from(inflight));
    if (timeoutMs <= 0) {
      await all;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => resolve(), timeoutMs);
    });
    await Promise.race([all, timeout]);
    if (timer) clearTimeout(timer);
  }

  return { log, flush };
}
