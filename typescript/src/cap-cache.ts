import type { CapCheckResult } from './types.js';
import { WeckrConfigError } from './errors.js';

const TTL_MS = 60_000; // 60-second per (userId, planName, model) cache

interface CacheEntry {
  result: CapCheckResult;
  expiresAt: number;
}

export interface CapCheckerOptions {
  apiKey: string;
  endpoint: string; // full URL to /api/v1/check
  fetch?: typeof fetch;
  onError?: (err: unknown) => void;
}

/**
 * Cache key includes model so a downgrade-to-mini for gpt-4o doesn't bleed
 * onto a subsequent claude-sonnet-4 call by the same user. JSON-encoded to
 * avoid string-concat collisions like `('a','b c')` == `('a b','c')`.
 */
function cacheKey(userId: string, planName: string, model: string | undefined): string {
  return JSON.stringify([userId, planName, model ?? null]);
}

export function createCapChecker(opts: CapCheckerOptions) {
  const f = opts.fetch ?? globalThis.fetch;
  const cache = new Map<string, CacheEntry>();
  // Concurrent calls for the same key share one in-flight Promise so we don't
  // make N parallel /check requests when N chat()s fire in the same tick.
  const inflight = new Map<string, Promise<CapCheckResult>>();

  return async function checkCap(
    userId: string,
    planName: string,
    model?: string,
  ): Promise<CapCheckResult> {
    const k = cacheKey(userId, planName, model);
    const now = Date.now();
    const hit = cache.get(k);
    if (hit && hit.expiresAt > now) return hit.result;

    const pending = inflight.get(k);
    if (pending) return pending;

    if (typeof f !== 'function') {
      // No fetch implementation — silently allow.
      return { allowed: true };
    }

    const fetchPromise = (async (): Promise<CapCheckResult> => {
      try {
        const url = new URL(opts.endpoint);
        url.searchParams.set('userId', userId);
        url.searchParams.set('planName', planName);
        if (model) url.searchParams.set('model', model);

        const res = await f(url.toString(), {
          method: 'GET',
          headers: { 'x-api-key': opts.apiKey },
        });

        // 401/403: typo'd / revoked api key. Fail CLOSED — throw a config
        // error synchronously. Silent fail-open here means the customer's
        // entire cap config is silently inactive.
        if (res.status === 401 || res.status === 403) {
          const body = await res.text().catch(() => '');
          throw new WeckrConfigError(
            res.status === 401 ? 'invalid_api_key' : 'forbidden',
            `Weckr: cap-check rejected with ${res.status}. Verify the api key is correct, ` +
              `not revoked, and active in the dashboard. Server said: ${body || '(no body)'}`,
          );
        }

        if (!res.ok) {
          opts.onError?.(
            new Error(`Weckr cap check failed: ${res.status} ${res.statusText}`),
          );
          // Fail open on 5xx / 429 / other 4xx (NOT 401/403) so our outage
          // doesn't take down customer apps. Don't cache the failure.
          return { allowed: true };
        }

        const json = (await res.json()) as CapCheckResult;
        cache.set(k, { result: json, expiresAt: Date.now() + TTL_MS });
        return json;
      } catch (err) {
        if (err instanceof WeckrConfigError) throw err;
        opts.onError?.(err);
        // Fail open on network errors.
        return { allowed: true };
      } finally {
        inflight.delete(k);
      }
    })();

    inflight.set(k, fetchPromise);
    return fetchPromise;
  };
}

export function deriveCheckEndpoint(logEndpoint: string): string {
  // Replace the last `/log` segment with `/check`. If endpoint doesn't end in
  // `/log`, the user must pass an explicit checkEndpoint — silently appending
  // `/../check` is too magical and gives unexpected 404s.
  if (logEndpoint.endsWith('/log')) return logEndpoint.slice(0, -'/log'.length) + '/check';
  throw new WeckrConfigError(
    'invalid_api_key', // closest reusable code; semantically a config bug
    `Weckr: cannot derive checkEndpoint from endpoint "${logEndpoint}" — it does not end in "/log". ` +
      `Pass an explicit \`checkEndpoint\` in the Weckr config.`,
  );
}
