import type { CapCheckResult } from './types.js';

/**
 * Thrown by `wk.chat(...)` when the configured spending cap has been hit and
 * the cap's action is `"block"`. The LLM call is never made.
 *
 * ```ts
 * try {
 *   await wk.chat(openai, opts);
 * } catch (err) {
 *   if (isWeckrCapError(err)) {
 *     // show the user a friendly upgrade prompt
 *   }
 * }
 * ```
 */
export class WeckrCapError extends Error {
  readonly name = 'WeckrCapError' as const;
  readonly userId: string;
  readonly planName: string;
  readonly currentSpend?: number;
  readonly cap?: number;

  constructor(opts: {
    userId: string;
    planName: string;
    currentSpend?: number;
    cap?: number;
    message?: string;
  }) {
    super(
      opts.message ??
        `Weckr: spending cap reached for user ${opts.userId} on plan ${opts.planName}`,
    );
    this.userId = opts.userId;
    this.planName = opts.planName;
    this.currentSpend = opts.currentSpend;
    this.cap = opts.cap;
  }
}

export function isWeckrCapError(e: unknown): e is WeckrCapError {
  return e instanceof Error && e.name === 'WeckrCapError';
}

export function capCheckToError(opts: {
  userId: string;
  planName: string;
  result: CapCheckResult;
}): WeckrCapError {
  return new WeckrCapError({
    userId: opts.userId,
    planName: opts.planName,
    currentSpend: opts.result.currentSpend,
    cap: opts.result.cap,
  });
}

/**
 * Thrown when the SDK detects an UNRECOVERABLE config error — typo'd api key
 * (401), revoked key (403), or plan-name passed to chat() that doesn't appear
 * in the constructor's `plans` dict.
 *
 * These fail-CLOSED on purpose: silent fail-open would silently disable cap
 * enforcement (security control) or silently poison dashboard data.
 */
export class WeckrConfigError extends Error {
  readonly name = 'WeckrConfigError' as const;
  readonly code: 'invalid_api_key' | 'forbidden' | 'unknown_plan';

  constructor(code: 'invalid_api_key' | 'forbidden' | 'unknown_plan', message: string) {
    super(message);
    this.code = code;
  }
}

export function isWeckrConfigError(e: unknown): e is WeckrConfigError {
  return e instanceof Error && e.name === 'WeckrConfigError';
}
