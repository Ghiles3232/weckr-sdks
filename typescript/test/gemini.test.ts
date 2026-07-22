import { describe, it, expect } from 'vitest';
import { normalizeUsage } from '../src/providers.js';
import { calculateCost } from '../src/pricing.js';

describe('Gemini: thinking-model output tokens', () => {
  it('includes thoughtsTokenCount in output (Google bills thinking as output)', () => {
    const u = normalizeUsage('gemini', {
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 40 },
    });
    expect(u.inputTokens).toBe(10);
    expect(u.outputTokens).toBe(45); // 5 visible answer + 40 hidden thinking
  });

  it('a non-thinking response (no thoughts field) is unchanged', () => {
    const u = normalizeUsage('gemini', {
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 150 },
    });
    expect(u.outputTokens).toBe(150);
  });
});

describe('Gemini 3.x pricing', () => {
  it('prices the current models and -latest aliases', () => {
    expect(calculateCost('gemini-flash-latest', 1_000_000, 1_000_000).costUsd).toBeCloseTo(9.0, 6);
    expect(calculateCost('gemini-flash-lite-latest', 1_000_000, 1_000_000).costUsd).toBeCloseTo(2.8, 6);
    expect(calculateCost('gemini-pro-latest', 1_000_000, 1_000_000).costUsd).toBeCloseTo(14.0, 6);
    expect(calculateCost('gemini-3.6-flash', 1_000_000, 1_000_000).costUsd).toBeCloseTo(9.0, 6);
    expect(calculateCost('gemini-3.5-flash-lite', 1_000_000, 1_000_000).costUsd).toBeCloseTo(2.8, 6);
    expect(calculateCost('gemini-3.1-pro-preview', 1_000_000, 1_000_000).costUsd).toBeCloseTo(14.0, 6);
  });

  it('a dated 3.x flash-lite variant resolves to flash-lite, not flash', () => {
    // longest-prefix: must pick gemini-3.5-flash-lite (0.30 input), not gemini-3.5-flash (1.50)
    expect(calculateCost('gemini-3.5-flash-lite-preview-0930', 1_000_000, 0).costUsd).toBeCloseTo(0.3, 6);
  });
});
