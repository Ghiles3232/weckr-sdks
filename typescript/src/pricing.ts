import type { Provider } from './types.js';

export interface ModelPricing {
  provider: Provider;
  inputPerMillion: number;
  outputPerMillion: number;
}

// KEEP IN SYNC with:
//   - weckr-api/lib/caps.ts              (server)
//   - weckr-python/weckr/pricing.py      (Python SDK)
// If you add a model here, add it there too.
export const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o':           { provider: 'openai', inputPerMillion: 2.5,  outputPerMillion: 10.0 },
  'gpt-4o-mini':      { provider: 'openai', inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4-turbo':      { provider: 'openai', inputPerMillion: 10,   outputPerMillion: 30 },
  'gpt-4':            { provider: 'openai', inputPerMillion: 30,   outputPerMillion: 60 },
  'gpt-3.5-turbo':    { provider: 'openai', inputPerMillion: 0.5,  outputPerMillion: 1.5 },
  'o1-preview':       { provider: 'openai', inputPerMillion: 15,   outputPerMillion: 60 },
  'o1-mini':          { provider: 'openai', inputPerMillion: 3,    outputPerMillion: 12 },
  // Anthropic
  'claude-opus-4':    { provider: 'anthropic', inputPerMillion: 15,  outputPerMillion: 75 },
  'claude-sonnet-4':  { provider: 'anthropic', inputPerMillion: 3,   outputPerMillion: 15 },
  'claude-haiku-4-5': { provider: 'anthropic', inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-5-sonnet':{ provider: 'anthropic', inputPerMillion: 3,   outputPerMillion: 15 },
  'claude-3-5-haiku': { provider: 'anthropic', inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-opus':    { provider: 'anthropic', inputPerMillion: 15,  outputPerMillion: 75 },
  // Gemini
  'gemini-2.5-pro':   { provider: 'gemini', inputPerMillion: 1.25,  outputPerMillion: 10 },
  'gemini-2.5-flash': { provider: 'gemini', inputPerMillion: 0.15,  outputPerMillion: 0.6 },
  'gemini-1.5-pro':   { provider: 'gemini', inputPerMillion: 1.25,  outputPerMillion: 5 },
  'gemini-1.5-flash': { provider: 'gemini', inputPerMillion: 0.075, outputPerMillion: 0.3 },
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

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { costUsd: number; provider: Provider | null } {
  const pricing = resolvePricing(model);
  if (!pricing) return { costUsd: 0, provider: null };
  const cost =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return { costUsd: round6(cost), provider: pricing.provider };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
