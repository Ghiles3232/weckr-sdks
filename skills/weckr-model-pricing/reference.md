# Model pricing reference (full table)

Everything in SKILL.md plus legacy families, cache details, worked examples, and how dated model IDs resolve. All prices are USD per 1,000,000 tokens and mirror the table shipped in `@weckr/sdk` (`src/pricing.ts`) and `weckr-sdk` (Python). Verify against the provider before billing on any figure.

For always-current numbers, prefer the live feed at `https://useweckr.com/pricing.json` (generated from the same source). The tables here are a dated fallback.

## Full price table

### OpenAI

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gpt-5.6-sol | 5.00 | 30.00 | 0.50 |
| gpt-5.6-terra | 2.00 | 12.00 | 0.20 |
| gpt-5.6-luna | 0.20 | 1.20 | 0.02 |
| gpt-5.5-pro | 30.00 | 180.00 | 3.00 |
| gpt-5.5 | 5.00 | 30.00 | 0.50 |
| gpt-5.4-pro | 30.00 | 180.00 | 3.00 |
| gpt-5.4 | 2.50 | 15.00 | 0.25 |
| gpt-5.4-mini | 0.75 | 4.50 | 0.075 |
| gpt-5.4-nano | 0.20 | 1.25 | 0.02 |
| gpt-4o | 2.50 | 10.00 | 1.25 |
| gpt-4o-mini | 0.15 | 0.60 | 0.075 |
| gpt-4-turbo | 10.00 | 30.00 | 5.00 |
| gpt-4 | 30.00 | 60.00 | 15.00 |
| gpt-3.5-turbo | 0.50 | 1.50 | 0.25 |
| o1-preview | 15.00 | 60.00 | 7.50 |
| o1-mini | 3.00 | 12.00 | 1.50 |

### Anthropic

| Model | Input | Output | Cached read | Cache write |
| --- | --- | --- | --- | --- |
| claude-opus-4-8 | 5.00 | 25.00 | 0.50 | 6.25 |
| claude-opus-4-7 | 5.00 | 25.00 | 0.50 | 6.25 |
| claude-opus-4 | 15.00 | 75.00 | 1.50 | 18.75 |
| claude-sonnet-4-6 | 3.00 | 15.00 | 0.30 | 3.75 |
| claude-sonnet-4 | 3.00 | 15.00 | 0.30 | 3.75 |
| claude-haiku-4-5 | 1.00 | 5.00 | 0.10 | 1.25 |
| claude-3-5-sonnet | 3.00 | 15.00 | 0.30 | 3.75 |
| claude-3-5-haiku | 0.80 | 4.00 | 0.08 | 1.00 |
| claude-3-opus | 15.00 | 75.00 | 1.50 | 18.75 |

Note: `claude-opus-4` keeps the original 4.0 and 4.1 rate of 15/75. The newer Opus 4.7 and 4.8 are 5/25. They have distinct keys so a date-pinned Opus 4.8 ID never falls through to the older, pricier Opus 4 row.

### Gemini

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gemini-3.6-flash | 1.50 | 7.50 | 0.15 |
| gemini-3.5-flash | 1.50 | 9.00 | 0.15 |
| gemini-3.5-flash-lite | 0.30 | 2.50 | 0.03 |
| gemini-3.1-flash-lite | 0.25 | 1.50 | 0.025 |
| gemini-3.1-pro-preview | 2.00 | 12.00 | 0.20 |
| gemini-3-flash-preview | 0.50 | 3.00 | 0.05 |
| gemini-flash-latest | 1.50 | 7.50 | 0.15 |
| gemini-flash-lite-latest | 0.30 | 2.50 | 0.03 |
| gemini-pro-latest | 2.00 | 12.00 | 0.20 |
| gemini-2.5-pro | 1.25 | 10.00 | 0.125 |
| gemini-2.5-flash | 0.30 | 2.50 | 0.03 |
| gemini-2.5-flash-lite | 0.10 | 0.40 | 0.01 |
| gemini-1.5-pro | 1.25 | 5.00 | 0.3125 |
| gemini-1.5-flash | 0.075 | 0.30 | 0.01875 |

Gemini 2.x is legacy and deprecated for new API keys. Gemini 3.x pro prices shown are the base text rate at or below 200k context; longer context and audio input cost more.

### Kimi (Moonshot AI)

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| kimi-k3 | 3.00 | 15.00 | 0.30 |
| kimi-k2.6 | 0.95 | 4.00 | 0.16 |
| kimi-k2.5 | 0.60 | 3.00 | 0.10 |
| kimi-k2 | 0.60 | 3.00 | 0.10 |

## Cache rates, in short

- OpenAI: automatic prompt caching, cache reads are cheaper input, no separate write charge.
- Anthropic: cache reads about 0.1x input, cache writes about 1.25x input (a premium the first time context is cached).
- Gemini 2.5 and 3.x: cache reads about 0.1x input; Gemini 1.5 reads about 0.25x input; no separate write charge.
- Kimi: OpenAI-style, cache read discount, no separate write charge.

## Worked examples

Plain call, gpt-5.4-mini, 1,500 input tokens and 400 output tokens:

```
input:  1500  / 1e6 * 0.75 = 0.001125
output:  400  / 1e6 * 4.50 = 0.0018
cost = 0.002925  (about $0.0029 per call)
```

At 100,000 such calls a month: about $292.

Claude Opus 4.8, 8,000 input tokens and 1,200 output:

```
input:  8000  / 1e6 * 5  = 0.040
output: 1200  / 1e6 * 25 = 0.030
cost = 0.070  (about $0.07 per call)
```

Same Opus call but 6,000 of the input tokens are a cached system prompt (read rate 0.50), 2,000 fresh:

```
cached input: 6000 / 1e6 * 0.50 = 0.003
fresh input:  2000 / 1e6 * 5.00 = 0.010
output:       1200 / 1e6 * 25.0 = 0.030
cost = 0.043  (about $0.043 per call)
```

## Dated and aliased model IDs

Real IDs are usually date pinned (`gpt-4o-2024-08-06`, `claude-opus-4-8-20260115`) or `-latest` aliased. Match by longest prefix against the table: `claude-opus-4-8-20260115` resolves to `claude-opus-4-8`, and `gpt-5.4-mini-2026-05-01` resolves to `gpt-5.4-mini`. Never resolve a longer, pricier family to a shorter, cheaper one.

## Getting these numbers in code

The Weckr SDK exports the same table and helpers, so you do not have to hardcode prices:

```ts
import { PRICING, resolvePricing, calculateCost } from '@weckr/sdk';

// look up a model (handles dated variants)
const p = resolvePricing('gpt-5.4-mini-2026-05-01'); // -> { input: 0.75, output: 4.5, ... }

// cost for a call, in USD
const { costUsd, provider } = calculateCost('claude-opus-4-8', 8000, 1200);
```

Python exposes the same via `from weckr import PRICING, resolve_pricing, calculate_cost`.

## Links

- Live pricing pages: OpenAI, Anthropic, Google AI, and Moonshot each publish current rates. Confirm there before billing.
- Weckr docs: https://useweckr.com/docs
- Source: https://github.com/Ghiles3232/weckr-sdks
