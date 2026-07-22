import type { Provider } from './types.js';

export interface ModelPricing {
  provider: Provider;
  inputPerMillion: number;
  outputPerMillion: number;
  /** Cache-READ input rate per million (discounted repeated context). */
  cachedInputPerMillion: number;
  /** Cache-WRITE rate per million. Anthropic only (write premium); omitted for
   *  OpenAI/Gemini which have no per-request write charge. */
  cacheWritePerMillion?: number;
}

// KEEP IN SYNC with:
//   - weckr-api/lib/caps.ts              (server, authoritative)
//   - weckr-python/weckr/pricing.py      (Python SDK)
// If you add a model here, add it there too.
//
// Cached rates verified against official provider pricing on 2026-07-18:
//   OpenAI gpt-4o + o-series: cache read = 0.5x input.
//   Anthropic (all):          cache read = 0.1x input, 5-min cache write = 1.25x input.
//   Gemini 2.5: cache read = 0.1x input.  Gemini 1.5: cache read = 0.25x input.
export const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o':           { provider: 'openai', inputPerMillion: 2.5,  outputPerMillion: 10.0, cachedInputPerMillion: 1.25 },
  'gpt-4o-mini':      { provider: 'openai', inputPerMillion: 0.15, outputPerMillion: 0.6,  cachedInputPerMillion: 0.075 },
  'gpt-4-turbo':      { provider: 'openai', inputPerMillion: 10,   outputPerMillion: 30,   cachedInputPerMillion: 5 },
  'gpt-4':            { provider: 'openai', inputPerMillion: 30,   outputPerMillion: 60,   cachedInputPerMillion: 15 },
  'gpt-3.5-turbo':    { provider: 'openai', inputPerMillion: 0.5,  outputPerMillion: 1.5,  cachedInputPerMillion: 0.25 },
  'o1-preview':       { provider: 'openai', inputPerMillion: 15,   outputPerMillion: 60,   cachedInputPerMillion: 7.5 },
  'o1-mini':          { provider: 'openai', inputPerMillion: 3,    outputPerMillion: 12,   cachedInputPerMillion: 1.5 },
  // GPT-5 family (current OpenAI generation; verified against
  // developers.openai.com/api/docs/pricing on 2026-07-22, Standard tier). 5.6
  // (sol/terra/luna) is the current flagship line; 5.5 and 5.4 remain available.
  'gpt-5.6-sol':      { provider: 'openai', inputPerMillion: 5,    outputPerMillion: 30,   cachedInputPerMillion: 0.5 },
  'gpt-5.6-terra':    { provider: 'openai', inputPerMillion: 2.5,  outputPerMillion: 15,   cachedInputPerMillion: 0.25 },
  'gpt-5.6-luna':     { provider: 'openai', inputPerMillion: 1,    outputPerMillion: 6,    cachedInputPerMillion: 0.1 },
  'gpt-5.5-pro':      { provider: 'openai', inputPerMillion: 30,   outputPerMillion: 180,  cachedInputPerMillion: 3 },
  'gpt-5.5':          { provider: 'openai', inputPerMillion: 5,    outputPerMillion: 30,   cachedInputPerMillion: 0.5 },
  'gpt-5.4-pro':      { provider: 'openai', inputPerMillion: 30,   outputPerMillion: 180,  cachedInputPerMillion: 3 },
  'gpt-5.4':          { provider: 'openai', inputPerMillion: 2.5,  outputPerMillion: 15,   cachedInputPerMillion: 0.25 },
  'gpt-5.4-mini':     { provider: 'openai', inputPerMillion: 0.75, outputPerMillion: 4.5,  cachedInputPerMillion: 0.075 },
  'gpt-5.4-nano':     { provider: 'openai', inputPerMillion: 0.2,  outputPerMillion: 1.25, cachedInputPerMillion: 0.02 },
  // Anthropic. Current flagships (verified 2026-07-19): Opus 4.8/4.7 = 5/25,
  // Sonnet 4.6 = 3/15, Haiku 4.5 = 1/5. `claude-opus-4` keeps the legacy 4.0/4.1
  // rate (15/75); newer variants get explicit longer-prefix keys.
  'claude-opus-4-8':  { provider: 'anthropic', inputPerMillion: 5,   outputPerMillion: 25, cachedInputPerMillion: 0.5,  cacheWritePerMillion: 6.25 },
  'claude-opus-4-7':  { provider: 'anthropic', inputPerMillion: 5,   outputPerMillion: 25, cachedInputPerMillion: 0.5,  cacheWritePerMillion: 6.25 },
  'claude-opus-4':    { provider: 'anthropic', inputPerMillion: 15,  outputPerMillion: 75, cachedInputPerMillion: 1.5,  cacheWritePerMillion: 18.75 },
  'claude-sonnet-4-6':{ provider: 'anthropic', inputPerMillion: 3,   outputPerMillion: 15, cachedInputPerMillion: 0.3,  cacheWritePerMillion: 3.75 },
  'claude-sonnet-4':  { provider: 'anthropic', inputPerMillion: 3,   outputPerMillion: 15, cachedInputPerMillion: 0.3,  cacheWritePerMillion: 3.75 },
  'claude-haiku-4-5': { provider: 'anthropic', inputPerMillion: 1,   outputPerMillion: 5,  cachedInputPerMillion: 0.1,  cacheWritePerMillion: 1.25 },
  'claude-3-5-sonnet':{ provider: 'anthropic', inputPerMillion: 3,   outputPerMillion: 15, cachedInputPerMillion: 0.3,  cacheWritePerMillion: 3.75 },
  'claude-3-5-haiku': { provider: 'anthropic', inputPerMillion: 0.8, outputPerMillion: 4,  cachedInputPerMillion: 0.08, cacheWritePerMillion: 1.0 },
  'claude-3-opus':    { provider: 'anthropic', inputPerMillion: 15,  outputPerMillion: 75, cachedInputPerMillion: 1.5,  cacheWritePerMillion: 18.75 },
  // Gemini
  'gemini-2.5-pro':   { provider: 'gemini', inputPerMillion: 1.25,  outputPerMillion: 10, cachedInputPerMillion: 0.125 },
  'gemini-2.5-flash':      { provider: 'gemini', inputPerMillion: 0.3, outputPerMillion: 2.5, cachedInputPerMillion: 0.03 },
  'gemini-2.5-flash-lite': { provider: 'gemini', inputPerMillion: 0.1, outputPerMillion: 0.4, cachedInputPerMillion: 0.01 },
  'gemini-1.5-pro':   { provider: 'gemini', inputPerMillion: 1.25,  outputPerMillion: 5,  cachedInputPerMillion: 0.3125 },
  'gemini-1.5-flash': { provider: 'gemini', inputPerMillion: 0.075, outputPerMillion: 0.3, cachedInputPerMillion: 0.01875 },
  // Gemini 3.x (current generation; 2.x above is legacy). Verified against
  // ai.google.dev/gemini-api/docs/pricing on 2026-07-22 (text base rate).
  'gemini-3.6-flash':         { provider: 'gemini', inputPerMillion: 1.5,  outputPerMillion: 7.5,  cachedInputPerMillion: 0.15 },
  'gemini-3.5-flash':         { provider: 'gemini', inputPerMillion: 1.5,  outputPerMillion: 9.0,  cachedInputPerMillion: 0.15 },
  'gemini-3.5-flash-lite':    { provider: 'gemini', inputPerMillion: 0.3,  outputPerMillion: 2.5,  cachedInputPerMillion: 0.03 },
  'gemini-3.1-flash-lite':    { provider: 'gemini', inputPerMillion: 0.25, outputPerMillion: 1.5,  cachedInputPerMillion: 0.025 },
  'gemini-3.1-pro-preview':   { provider: 'gemini', inputPerMillion: 2.0,  outputPerMillion: 12.0, cachedInputPerMillion: 0.20 },
  'gemini-3-flash-preview':   { provider: 'gemini', inputPerMillion: 0.5,  outputPerMillion: 3.0,  cachedInputPerMillion: 0.05 },
  'gemini-flash-latest':      { provider: 'gemini', inputPerMillion: 1.5,  outputPerMillion: 7.5,  cachedInputPerMillion: 0.15 },
  'gemini-flash-lite-latest': { provider: 'gemini', inputPerMillion: 0.3,  outputPerMillion: 2.5,  cachedInputPerMillion: 0.03 },
  'gemini-pro-latest':        { provider: 'gemini', inputPerMillion: 2.0,  outputPerMillion: 12.0, cachedInputPerMillion: 0.20 },
  // Kimi (Moonshot AI). OpenAI-compatible API, so usage + cache fields match
  // OpenAI's shape. Rates are approximate and change often; verify at
  // platform.moonshot.ai before relying on them long term (lastVerified 2026-07-22):
  // K3 = 3/15, K2.6 = 0.95/4, K2.5 = 0.60/3, K2 (older tier) approx 0.60/3.
  'kimi-k3':          { provider: 'kimi', inputPerMillion: 3.0,  outputPerMillion: 15.0, cachedInputPerMillion: 0.30 },
  'kimi-k2.6':        { provider: 'kimi', inputPerMillion: 0.95, outputPerMillion: 4.0,  cachedInputPerMillion: 0.16 },
  'kimi-k2.5':        { provider: 'kimi', inputPerMillion: 0.6,  outputPerMillion: 3.0,  cachedInputPerMillion: 0.10 },
  'kimi-k2':          { provider: 'kimi', inputPerMillion: 0.6,  outputPerMillion: 3.0,  cachedInputPerMillion: 0.10 },
};

/**
 * Resolve pricing for a model name, allowing dated variants.
 *
 * Real-world IDs are date-pinned (`gpt-4o-2024-08-06`, `claude-opus-4-20250514`,
 * `claude-3-5-sonnet-latest`). Strict equality would silently log cost=0 for
 * those — which neuters every cap. So we longest-prefix-match against PRICING:
 * `claude-3-5-sonnet-20241022` resolves to `claude-3-5-sonnet`, not the
 * shorter `claude-3` family.
 */
export function resolvePricing(model: string): ModelPricing | null {
  if (PRICING[model]) return PRICING[model]!;
  const lower = model.toLowerCase();
  let best: { key: string; pricing: ModelPricing } | null = null;
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (lower.startsWith(key.toLowerCase())) {
      if (!best || key.length > best.key.length) best = { key, pricing };
    }
  }
  return best?.pricing ?? null;
}

/**
 * Prompt-cache aware. `cachedInputTokens` is the cache-READ subset already
 * included in `inputTokens` (billed at the discounted rate); `cacheCreationTokens`
 * is additive cache-WRITE volume (Anthropic). Both default to 0. The server
 * recomputes and ignores this value, so it is only the SDK's local estimate.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
  cacheCreationTokens = 0,
): { costUsd: number; provider: Provider | null } {
  const pricing = resolvePricing(model);
  if (!pricing) return { costUsd: 0, provider: null };
  const cached = Math.max(0, Math.min(cachedInputTokens, inputTokens));
  const uncached = inputTokens - cached;
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const writeRate = pricing.cacheWritePerMillion ?? pricing.inputPerMillion;
  const cost =
    (uncached / 1_000_000) * pricing.inputPerMillion +
    (cached / 1_000_000) * cachedRate +
    (Math.max(0, cacheCreationTokens) / 1_000_000) * writeRate +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return { costUsd: round6(cost), provider: pricing.provider };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
