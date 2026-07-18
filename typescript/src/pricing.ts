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
  // Anthropic
  'claude-opus-4':    { provider: 'anthropic', inputPerMillion: 15,  outputPerMillion: 75, cachedInputPerMillion: 1.5,  cacheWritePerMillion: 18.75 },
  'claude-sonnet-4':  { provider: 'anthropic', inputPerMillion: 3,   outputPerMillion: 15, cachedInputPerMillion: 0.3,  cacheWritePerMillion: 3.75 },
  'claude-haiku-4-5': { provider: 'anthropic', inputPerMillion: 0.8, outputPerMillion: 4,  cachedInputPerMillion: 0.08, cacheWritePerMillion: 1.0 },
  'claude-3-5-sonnet':{ provider: 'anthropic', inputPerMillion: 3,   outputPerMillion: 15, cachedInputPerMillion: 0.3,  cacheWritePerMillion: 3.75 },
  'claude-3-5-haiku': { provider: 'anthropic', inputPerMillion: 0.8, outputPerMillion: 4,  cachedInputPerMillion: 0.08, cacheWritePerMillion: 1.0 },
  'claude-3-opus':    { provider: 'anthropic', inputPerMillion: 15,  outputPerMillion: 75, cachedInputPerMillion: 1.5,  cacheWritePerMillion: 18.75 },
  // Gemini
  'gemini-2.5-pro':   { provider: 'gemini', inputPerMillion: 1.25,  outputPerMillion: 10, cachedInputPerMillion: 0.125 },
  'gemini-2.5-flash': { provider: 'gemini', inputPerMillion: 0.15,  outputPerMillion: 0.6, cachedInputPerMillion: 0.015 },
  'gemini-1.5-pro':   { provider: 'gemini', inputPerMillion: 1.25,  outputPerMillion: 5,  cachedInputPerMillion: 0.3125 },
  'gemini-1.5-flash': { provider: 'gemini', inputPerMillion: 0.075, outputPerMillion: 0.3, cachedInputPerMillion: 0.01875 },
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
