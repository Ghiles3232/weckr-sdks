# @weckr/sdk

AI cost and margin intelligence for SaaS founders.

See exactly which users cost more than they pay — per LLM call, zero added latency.

## Try it live

See the dashboard with real data — no signup needed.
👉 https://app.useweckr.com/demo

## Install

```bash
npm install @weckr/sdk
```

## Usage

```ts
import { Weckr } from '@weckr/sdk';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const wk = new Weckr({
  apiKey: 'wk_your_key_here',
  plans: {
    free: 0,
    starter: 9,
    pro: 29,
    business: 99,
  },
});

const result = await wk.chat(openai, {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: prompt }],
  userId: user.id,
  feature: 'ai-summary',
  plan: user.plan,
});
```

> See your own data in the dashboard: https://app.useweckr.com/dashboard
> Try the demo without signing up: https://app.useweckr.com/demo

The original LLM call runs unchanged and returns immediately. After it resolves, Weckr fires an async log to the Weckr API. The log call is fire-and-forget — if it fails or stalls, your request is unaffected.

## Get your API key

Sign up at [https://useweckr.com](https://useweckr.com).

## Supported providers

- **OpenAI** — `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`, `o1-preview`, `o1-mini`
- **Anthropic** — `claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4-5`, `claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-3-opus`
- **Gemini** — `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`

Dated variants (`gpt-4o-2024-08-06`, `claude-3-5-sonnet-latest`, …) resolve to the matching family by longest-prefix lookup. Unknown models log `costUsd = 0` and don't trigger caps.

## Caps + downgrades

Set per-plan spending caps in the dashboard. When a user crosses their cap:

- `action: 'block'` → `wk.chat()` throws `WeckrCapError` (LLM call never made)
- `action: 'downgrade'` → the SDK silently swaps the model for a cheaper one in the same provider (`gpt-4o` → `gpt-4o-mini`, `claude-opus-4` → `claude-sonnet-4`, etc.)

Errors come in two flavors:

```ts
import { isWeckrCapError, isWeckrConfigError } from '@weckr/sdk';

try {
  await wk.chat(openai, opts);
} catch (err) {
  if (isWeckrCapError(err))   return showUpgradePrompt(err);
  if (isWeckrConfigError(err)) return logBackendAlert(err); // typo'd api key, unknown plan
  throw err; // real LLM error
}
```

## Short-lived processes (Lambda, cron, CLI)

`wk.chat()` returns as soon as the LLM call resolves; the log POST is fire-and-forget. In short-lived processes call `await wk.flush()` before exit to give the POSTs time to land:

```ts
await wk.chat(openai, opts);
await wk.flush(); // default 5s timeout
```

## What gets logged

```ts
{
  userId, feature, model, provider,
  inputTokens, outputTokens,
  costUsd, latencyMs,
  planName, planRevenueUsd, marginUsd,
  timestamp,
}
```

Cost is computed from public per-token pricing. Margin is `planRevenueUsd - costUsd` (negative means you're losing money on that user).

## Dashboard

View cost and margin data at [https://useweckr.com/dashboard](https://useweckr.com/dashboard).

## License

MIT
