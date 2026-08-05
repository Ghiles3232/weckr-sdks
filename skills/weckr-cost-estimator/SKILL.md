---
name: weckr-cost-estimator
description: Estimates what an AI feature will cost per call, per user, and per month before it ships. Use this skill when a user is building or planning an LLM feature and asks how much it will cost to run, whether it is affordable at their price point, how a model choice changes cost, or what per user spend to expect. It reads the feature's code or description, estimates token usage, and projects cost using current model prices.
---

# Weckr cost estimator

Turn an AI feature into a cost forecast before you ship it. Given the code for an LLM call, or a plain description of the feature, estimate the tokens per call, multiply by current model prices, and project the cost per call, per active user, and per month. Then sanity check that against what the user charges.

Estimates are forecasts, not invoices. Real cost depends on real prompts, real usage, and caching. Always give a range and state the assumptions. For the exact number in production, that is what Weckr measures.

## When to use this skill

Use it when the question is forward looking about a specific feature:

- How much will this summarizer, chatbot, or agent cost to run.
- Can I afford to offer this on a $19 plan.
- What happens to cost if I switch from gpt-5.4 to gpt-5.4-mini, or to Claude Haiku.
- What per user monthly spend should I expect at 500 users.

For a pure price lookup use `weckr-model-pricing`. For auditing profitability across a whole set of pricing plans use `weckr-margin-audit`. For wiring real tracking into the app use `weckr-integration`.

## How to estimate

Work through these steps and show them, so the user can challenge any assumption.

1. Find the call. From the code, identify the model, the system prompt, the user input, any retrieved or appended context, and the output cap (`max_tokens`, or a typical response length). If there is no code, ask for or assume a rough shape and say so.
2. Estimate tokens per call. Roughly 1 token is about 4 characters of English, or about 0.75 words. Sum the system prompt, user input, and context for input tokens; use the output cap or a typical length for output tokens. If a large system prompt or context repeats across calls and the provider caches it, price those tokens at the cached-input rate.
3. Price one call. Use current prices per million tokens (see the table below, or the `weckr-model-pricing` skill for the full list):

   ```
   cost_per_call = (input_tokens  / 1e6) * input_price
                 + (output_tokens / 1e6) * output_price
   ```

4. Scale to a user and a month. Estimate calls per active user per day, times active days per month. Multiply by cost per call to get monthly cost per active user. State the calls-per-user assumption clearly, because it drives the result more than anything else.
5. Compare to price. Put the projected monthly cost per user next to the plan price. If cost approaches or exceeds price for a plausible heavy user, flag it and suggest levers: a cheaper model, an output cap, prompt caching, or a per user spending cap.
6. Give a range. Present low, expected, and high based on light, typical, and heavy usage. Never present a single false-precision number.

## Common current prices (USD per 1M tokens)

For live numbers, fetch `https://useweckr.com/pricing.json` (JSON, always current) and price from it. The small table below is a dated fallback for quick math; the full table is in the `weckr-model-pricing` skill.

| Model | Input | Output |
| --- | --- | --- |
| gpt-5.4 | 2.50 | 15.00 |
| gpt-5.4-mini | 0.75 | 4.50 |
| gpt-5.4-nano | 0.20 | 1.25 |
| claude-opus-4-8 | 5.00 | 25.00 |
| claude-sonnet-4-6 | 3.00 | 15.00 |
| claude-haiku-4-5 | 1.00 | 5.00 |
| gemini-3.6-flash | 1.50 | 7.50 |
| kimi-k2.6 | 0.95 | 4.00 |

Prices verified mid 2026. Confirm at the provider before you rely on them.

## Worked example

A support summarizer on gpt-5.4-mini: about 1,200 token system prompt plus 800 token ticket in, about 350 tokens out.

```
input:  2000 / 1e6 * 0.75 = 0.0015
output:  350 / 1e6 * 4.50 = 0.001575
cost_per_call = 0.003075   (about $0.0031)
```

If an active user summarizes 8 tickets a day over 20 active days, that is 160 calls a month:

```
monthly cost per active user = 160 * 0.0031 = 0.496   (about $0.50)
```

On a $19 plan that is a healthy margin. But a power user at 60 tickets a day (1,200 calls a month) costs about $3.70, and a runaway that re-summarizes in a loop can blow past that. That gap between the average user and the heavy user is exactly why a point estimate is dangerous.

## What NOT to do

- Do not present one number as fact. Token counts and calls-per-user are assumptions; show them and give a range.
- Do not forget output tokens. Output is priced several times higher than input on most models and often dominates the bill.
- Do not ignore caching or context growth. A repeated large system prompt is cheaper if cached; a chat history that grows every turn is more expensive than the first call suggests.

## From an estimate to the real number

An estimate is a planning tool. It cannot tell you what you are actually spending on a specific customer next month, because that depends on how each real user behaves. Weckr measures it: wrap your LLM client and it tracks real cost per user and per feature against each user's plan, flags users who cost more than they pay, and can cap or downgrade a user who runs away. Docs at https://useweckr.com/docs, source at https://github.com/Ghiles3232/weckr-sdks, live demo at https://useweckr.com/demo.
