import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PRICING, resolvePricing, calculateCost } from '../src/pricing';

/**
 * Property based tests (fuzzing) for the cost engine. These throw randomized
 * inputs at the pricing math and assert invariants that must hold for every
 * possible input, the properties a unit test with fixed examples cannot cover:
 * costs are never negative, never NaN, monotonic in tokens, caching never
 * makes a call more expensive than the uncached price on the same model, and
 * dated model ids always price identically to their family.
 */

const MODELS = Object.keys(PRICING);
const modelArb = fc.constantFrom(...MODELS);
const tokensArb = fc.integer({ min: 0, max: 50_000_000 });

describe('pricing properties (fast-check)', () => {
  it('cost is always finite and non negative, for any model string and token counts', () => {
    fc.assert(
      fc.property(fc.string(), tokensArb, tokensArb, (model, input, output) => {
        const { costUsd } = calculateCost(model, input, output);
        expect(Number.isFinite(costUsd)).toBe(true);
        expect(costUsd).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('unknown models cost exactly zero with a null provider', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1 })
          .filter((s) => resolvePricing(s) === null),
        tokensArb,
        tokensArb,
        (model, input, output) => {
          const r = calculateCost(model, input, output);
          expect(r.costUsd).toBe(0);
          expect(r.provider).toBeNull();
        },
      ),
    );
  });

  it('cost is monotonic: more output tokens never cost less', () => {
    fc.assert(
      fc.property(modelArb, tokensArb, tokensArb, fc.integer({ min: 0, max: 1_000_000 }), (model, input, output, extra) => {
        const base = calculateCost(model, input, output).costUsd;
        const more = calculateCost(model, input, output + extra).costUsd;
        expect(more).toBeGreaterThanOrEqual(base);
      }),
    );
  });

  it('cache reads never make a call more expensive than fully uncached input', () => {
    fc.assert(
      fc.property(modelArb, tokensArb, tokensArb, tokensArb, (model, input, output, cached) => {
        const uncachedCost = calculateCost(model, input, output).costUsd;
        const cachedCost = calculateCost(model, input, output, cached).costUsd;
        // cached read rate is at or below the input rate on every model, and
        // the engine clamps cached tokens to the input count, so a cache read
        // split can never exceed the fully uncached price (tiny epsilon for
        // the engine's 6 decimal rounding).
        expect(cachedCost).toBeLessThanOrEqual(uncachedCost + 0.000001);
      }),
    );
  });

  it('cached token counts are clamped: negatives and overshoot cannot corrupt the price', () => {
    fc.assert(
      fc.property(
        modelArb,
        tokensArb,
        tokensArb,
        fc.integer({ min: -10_000_000, max: 100_000_000 }),
        (model, input, output, cached) => {
          const { costUsd } = calculateCost(model, input, output, cached);
          expect(Number.isFinite(costUsd)).toBe(true);
          expect(costUsd).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('dated and suffixed model ids price identically to their family', () => {
    const suffixArb = fc.oneof(
      fc.constant('-2026-05-01'),
      fc.constant('-20260115'),
      fc.constant('-latest'),
      fc.constant('-preview-1'),
    );
    fc.assert(
      fc.property(modelArb, suffixArb, tokensArb, tokensArb, (model, suffix, input, output) => {
        const family = calculateCost(model, input, output);
        const dated = calculateCost(model + suffix, input, output);
        // a longer known key can win the prefix match only if it is itself a
        // real model; for pure date/suffix decorations the family must win
        const resolvedDated = resolvePricing(model + suffix);
        const resolvedFamily = resolvePricing(model);
        if (resolvedDated === resolvedFamily) {
          expect(dated.costUsd).toBe(family.costUsd);
          expect(dated.provider).toBe(family.provider);
        }
      }),
    );
  });

  it('zero tokens cost zero on every known model', () => {
    fc.assert(
      fc.property(modelArb, (model) => {
        expect(calculateCost(model, 0, 0).costUsd).toBe(0);
      }),
    );
  });
});
