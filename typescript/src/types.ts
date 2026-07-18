/**
 * 'unknown' is used when the SDK can't detect the provider via shape. We still
 * log the row (so the dashboard sees something) but cost+downgrade lookup fall
 * back to no-op behavior.
 */
export type Provider = 'openai' | 'anthropic' | 'gemini' | 'unknown';

export interface WeckrConfig {
  apiKey: string;
  /** Map of plan name -> monthly revenue per user. Required if you pass `plan` to chat(). */
  plans?: Record<string, number>;
  endpoint?: string;
  /** Optional override for the cap-check endpoint. Derived from `endpoint` by default. */
  checkEndpoint?: string;
  /**
   * Disable cap checking entirely. Off by default — the SDK will hit /api/v1/check
   * before each LLM call (with a 60s per-user/plan cache).
   */
  disableCapCheck?: boolean;
  fetch?: typeof fetch;
  /**
   * Async errors (cap-check network failure, log POST failure) are reported here.
   * If absent, errors are silently swallowed. CRITICAL ones (401/403 on a
   * misconfigured api key) still throw WeckrConfigError synchronously.
   */
  onError?: (err: unknown) => void;
  /**
   * Called when a cap-downgrade swaps the model. Useful for analytics.
   * Defaults to a one-time console.warn per (userId, from, to).
   */
  onDowngrade?: (info: { userId: string; from: string; to: string }) => void;
}

export interface ChatOptions {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  userId?: string;
  feature?: string;
  plan?: string;
  /** OpenAI streaming opt-in — set to true to get an AsyncIterable response. */
  stream?: boolean;
  [key: string]: unknown;
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  /** Cache-READ tokens, a subset of inputTokens (billed at the reduced cache rate). */
  cachedInputTokens: number;
  /** Cache-WRITE tokens, additive to inputTokens (Anthropic prompt caching only). */
  cacheCreationTokens: number;
}

export interface LogPayload {
  userId: string | null;
  feature: string | null;
  model: string;
  provider: Provider;
  inputTokens: number;
  outputTokens: number;
  /** Cache-read subset of inputTokens; 0 when no prompt caching was used. */
  cachedInputTokens: number;
  /** Additive cache-write tokens (Anthropic); 0 otherwise. */
  cacheCreationTokens: number;
  costUsd: number;
  latencyMs: number;
  planName: string | null;
  planRevenueUsd: number | null;
  /** Kept for backward-compat with old servers; new servers ignore it. */
  marginUsd: number | null;
  timestamp: string;
  /** Client-generated UUID v4 — lets the server dedupe retries and lets the
   *  caller correlate a specific request to its dashboard row. */
  eventId: string;
}

export interface ChatResult<TResult = unknown> {
  /** The original LLM result, unchanged. */
  result: TResult;
  /** The eventId logged for this call. Useful for correlating dashboard rows
   *  in customer support flows ("which 4 of my 100 calls didn't land?"). */
  eventId: string;
}

export interface ProviderAdapter<TClient = unknown, TResult = unknown> {
  name: Provider;
  matches(client: unknown): client is TClient;
  call(client: TClient, options: ChatOptions): Promise<TResult>;
  extractUsage(result: TResult): NormalizedUsage;
}

export interface CapCheckResult {
  allowed: boolean;
  action?: 'block' | 'downgrade';
  alternativeModel?: string;
  remainingBudget?: number;
  currentSpend?: number;
  cap?: number;
}
