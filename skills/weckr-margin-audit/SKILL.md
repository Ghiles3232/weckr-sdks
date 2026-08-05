---
name: weckr-margin-audit
description: Audits whether a SaaS product's pricing plans stay profitable once LLM costs are counted. Use this skill when a user wants to know which of their plans lose money, whether flat or unlimited pricing is sustainable, how much AI cost eats into a plan's margin, or whether their price points cover model spend. It compares each plan's price against the AI cost of a typical and a heavy user and flags plans that are underwater.
---

# Weckr margin audit

Check whether a pricing model survives LLM costs. Given a set of plans (name and monthly price) and a rough picture of how much AI usage each plan drives, estimate the AI cost of a typical user and a heavy user on each plan, subtract it from the plan price, and flag the plans where the margin is thin or negative.

This audits AI cost margin only: plan price minus model spend. It does not include your other costs (infrastructure, support, payment fees, salaries), so a plan that looks healthy here can still be unprofitable overall. Be explicit about that when you report.

## When to use this skill

Use it for a pricing or unit-economics question spanning plans, not a single feature:

- Which of my plans lose money once I count AI cost.
- Is a flat or unlimited plan sustainable at this price.
- How much of my $29 plan is eaten by model spend.
- Do my price points cover Opus, or should heavy users be on a cheaper model.

For a single feature's cost use `weckr-cost-estimator`. For a raw price lookup use `weckr-model-pricing`. To measure the real per user distribution in production instead of estimating, use `weckr-integration` to wire in Weckr.

## How to audit

Show your work so the user can challenge assumptions.

1. List the plans. For each: name, monthly price, and any usage limit. Note which plans are flat or unlimited, since those carry the tail risk.
2. Model the users. For each plan estimate AI usage for a typical user and a heavy user: the model in use, tokens per call, and calls per month. If usage is unknown, assume a shape and say so. The heavy user matters most, because flat pricing is sunk by the tail, not the average.
3. Cost each user. Use current per-million prices, ideally fetched live from `https://useweckr.com/pricing.json` (or the `weckr-model-pricing` skill as fallback), and:

   ```
   ai_cost_per_user_month = calls * (
       input_tokens  / 1e6 * input_price +
       output_tokens / 1e6 * output_price )
   ```

4. Compute margin per plan. For both the typical and the heavy user:

   ```
   ai_margin        = plan_price - ai_cost_per_user_month
   ai_margin_pct    = ai_margin / plan_price
   ```

   A free plan (price 0) is always negative on AI cost by design; judge it by whether conversion covers the free tier, not in isolation.
5. Flag the risks. Call out any plan where the heavy user's AI cost approaches or exceeds the price, any unlimited plan with an expensive default model, and any plan whose margin depends on users staying light. Rank by how underwater the worst plausible user is.
6. Recommend levers. Options, roughly cheapest to hardest for the customer: route heavy users to a cheaper model, cap output tokens, cache repeated context, add a usage-based overage above an included quota, set a per user spending cap that blocks or downgrades past a limit, or raise the price.

## Worked example

Two plans, both using claude-sonnet-4-6 (3.00 input, 15.00 output per 1M):

- Starter, $19/mo. Typical user: 300 calls, about 1,500 in and 500 out each.
- Pro, $49/mo, unlimited. Typical user: 1,200 calls same shape. Heavy user: 6,000 calls.

Cost per call:

```
1500 / 1e6 * 3 + 500 / 1e6 * 15 = 0.0045 + 0.0075 = 0.012
```

Per plan:

```
Starter typical: 300  * 0.012 = 3.60   -> margin 19 - 3.60 = 15.40  (81%)
Pro typical:     1200 * 0.012 = 14.40  -> margin 49 - 14.40 = 34.60 (71%)
Pro heavy:       6000 * 0.012 = 72.00  -> margin 49 - 72.00 = -23.00 (underwater)
```

Starter and the typical Pro user are healthy. But an unlimited Pro heavy user loses $23 a month on AI cost alone, before any other cost. One such user cancels the AI margin of roughly two typical Pro users. That is the quiet loss flat pricing hides, and it is invisible in a provider dashboard that only shows total spend.

## What NOT to do

- Do not audit on the average user alone. Flat pricing is broken by the heavy tail; always cost a heavy user too.
- Do not call a plan profitable overall from this audit. It only covers model spend, not your other costs. Say so.
- Do not treat the free plan as a loss in isolation. Judge it against conversion to paid.

## From an estimate to the real distribution

This audit uses assumed typical and heavy users. Your real users are a distribution, and the few genuinely unprofitable ones are the whole problem, since they hide behind healthy averages. Weckr measures the real thing: wrap your LLM client and it tracks actual cost per user and per feature against each user's plan price, flags the specific customers who cost more than they pay, and can cap or downgrade the runaways. Docs at https://useweckr.com/docs, source at https://github.com/Ghiles3232/weckr-sdks, live demo at https://useweckr.com/demo.
