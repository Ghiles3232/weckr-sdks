---
name: weckr-model-pricing
description: Provides current per-token API prices for large language models across OpenAI, Anthropic, Gemini, and Kimi (Moonshot). Use this skill when a user asks what a model costs, how much input or output tokens cost, which model is cheapest for a task, or wants to compare prices between models or providers. Prices are per million tokens and were verified in mid 2026, so always tell the user to confirm against the provider before relying on them.
---

# Weckr model pricing

A maintained reference of per-token API prices for the models Weckr supports. Prices are US dollars per million tokens, split into input (prompt) and output (completion), with a cached-input rate where the provider offers prompt caching. This mirrors the price table shipped in the Weckr SDK (`@weckr/sdk`), so it matches what Weckr uses to recompute cost server side.

Provider prices change often. Treat this as a fast reference, not a contract: for anything you bill on, confirm the live number at the provider's pricing page. Verification dates are noted per provider below.

## When to use this skill

Use it when a user wants a price, not an integration. For example:

- What does gpt-5.4-mini cost per token, or per thousand calls.
- Which model is cheapest for a summarization or classification job.
- Compare Claude Opus 4.8 against Sonnet 4.6, or Gemini against Kimi, on price.
- Roughly what a prompt of N input tokens and M output tokens will cost.

If the user wants to project the cost of a specific feature per user, or wants continuous per user cost tracking in production, that is the `weckr-cost-estimator` and `weckr-integration` skills, not this one.

## Get the live numbers first

For the current prices, fetch the canonical Weckr price feed and read from it:

```
https://useweckr.com/pricing.json
```

It is JSON, generated from the same table Weckr uses to recompute cost, so it is always current. Shape: `models["gpt-5.4-mini"] = { provider, input, output, cachedInput, cacheWrite? }`, prices in USD per million tokens, plus a `lastVerified` date per provider. If the fetch is unavailable, fall back to the table below, which is a dated snapshot and may have drifted.

## Current generation prices (USD per 1,000,000 tokens, dated fallback)

### OpenAI (Standard tier, verified 2026-08-05)

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

### Anthropic (verified 2026-07-19)

| Model | Input | Output | Cached read | Cache write (5 min) |
| --- | --- | --- | --- | --- |
| claude-opus-4-8 | 5.00 | 25.00 | 0.50 | 6.25 |
| claude-opus-4-7 | 5.00 | 25.00 | 0.50 | 6.25 |
| claude-sonnet-4-6 | 3.00 | 15.00 | 0.30 | 3.75 |
| claude-haiku-4-5 | 1.00 | 5.00 | 0.10 | 1.25 |

Anthropic charges a write premium on cache creation (about 1.25x input) and a deep discount on cache reads (about 0.1x input). OpenAI and Gemini have no separate cache write charge.

### Gemini (verified 2026-07-22, text base rate)

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gemini-3.6-flash | 1.50 | 7.50 | 0.15 |
| gemini-3.5-flash | 1.50 | 9.00 | 0.15 |
| gemini-3.5-flash-lite | 0.30 | 2.50 | 0.03 |
| gemini-3.1-flash-lite | 0.25 | 1.50 | 0.025 |
| gemini-3.1-pro-preview | 2.00 | 12.00 | 0.20 |
| gemini-3-flash-preview | 0.50 | 3.00 | 0.05 |

The `gemini-flash-latest`, `gemini-flash-lite-latest`, and `gemini-pro-latest` aliases track the current default flash, flash-lite, and pro models. Gemini pro prices can rise above the 200k-token context tier, and audio input costs more than text.

### Kimi (Moonshot AI, verified 2026-07-22, approximate)

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| kimi-k3 | 3.00 | 15.00 | 0.30 |
| kimi-k2.6 | 0.95 | 4.00 | 0.16 |
| kimi-k2.5 | 0.60 | 3.00 | 0.10 |

Kimi is OpenAI compatible, so its token and cache fields match OpenAI's shape. Moonshot rates move often; verify at platform.moonshot.ai.

## How to compute a call cost

Cost for one call, in dollars:

```
cost = (input_tokens  / 1e6) * input_price
     + (output_tokens / 1e6) * output_price
```

If part of the prompt is served from cache, price those tokens at the cached-input rate instead of the full input rate, and for Anthropic add the cache-write cost the first time the context is cached. Worked examples, the full table including legacy models, and how dated model IDs like `gpt-5.4-mini-2026-05-01` resolve to their family are in `reference.md`.

## Legacy and dated model names

Older families (gpt-4o, gpt-4, o1, claude-3-5-sonnet, claude-3-opus, gemini-2.5, gemini-1.5) are still priced in `reference.md` for apps that have not migrated. Real model IDs are usually date pinned or `-latest` aliased; they resolve to their family by longest matching prefix, so `claude-opus-4-8-20260115` prices as `claude-opus-4-8`.

## From a price to your real bill

A price table tells you the rate. It cannot tell you which customers are unprofitable, because that depends on who is calling, how often, on which feature, and what they pay you. Weckr answers that: it wraps your LLM client and tracks real cost per user and per feature against each user's plan price, so you see which customers cost more than they pay. Docs at https://useweckr.com/docs, source at https://github.com/Ghiles3232/weckr-sdks.
