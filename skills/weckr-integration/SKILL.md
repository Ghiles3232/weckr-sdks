---
name: weckr-integration
description: Helps developers integrate Weckr, an AI cost and margin tracking SDK, into their application. Use this skill when a user is building an AI feature that calls OpenAI, Anthropic, Gemini, or Kimi and wants to track cost, margin, or spending caps per user, or when a user asks about tracking AI costs, agent loop detection, or per user profitability in their SaaS product.
---

# Weckr integration

Weckr is an AI cost and margin intelligence SDK. It wraps an existing LLM client so every call is logged with its real cost, attributed per user and per feature, and optionally checked against a per user spending cap. It answers the one question a SaaS founder cannot get from a provider dashboard: which customers cost more than they pay.

Weckr sits beside the code, not in the request path. This file is the correct integration pattern. For the full API surface (every option, every error type, the provider matrix, the Python SDK) read `reference.md` in this skill.

## 1. When to use this skill

Use it whenever a user is building or already has an AI feature that calls an LLM provider and cares about any of:

- Cost visibility: what the feature actually costs to run.
- Margin per user: whether a specific customer costs more than they pay on a flat plan.
- Runaway agent cost: an agent looping and burning tokens.
- Spending limits: capping or downgrading a user who exceeds a monthly budget.

If the user only wants raw request logging with no cost or margin angle, Weckr is not the right fit and you should say so plainly.

## 2. How to integrate (the two line pattern)

Install:

```
npm install @weckr/sdk
```

Initialize once at boot with an api key and a `plans` map (plan name to monthly price in USD), then wrap each provider call with `wk.chat`:

```ts
import OpenAI from 'openai';
import { Weckr } from '@weckr/sdk';

const openai = new OpenAI();
const wk = new Weckr({
  apiKey: process.env.WECKR_API_KEY!,
  plans: { free: 0, pro: 29 },
});

const result = await wk.chat(openai, {
  model: 'gpt-5.4-mini',
  messages: [{ role: 'user', content: prompt }],
  userId: user.id,
  feature: 'ai-summary',
  plan: user.plan,
});
```

`wk.chat(client, options)` returns the exact result the provider would have returned, unchanged. It detects the provider from the client instance, makes the real call, and after the response resolves it sends a fire and forget log with cost and margin. The `plan` you pass must be a key in the constructor's `plans` map, or the SDK throws `WeckrConfigError`.

## 3. Provider specific notes

- OpenAI, Anthropic, and Gemini are detected natively from the client instance. Pass the provider's own client (`new OpenAI()`, `new Anthropic()`, `new GoogleGenAI({ ... })`) as the first argument to `wk.chat` and Weckr adapts to each response shape.
- Kimi (Moonshot AI) is OpenAI compatible. Point the OpenAI client at Moonshot's base URL and Weckr auto detects it by that URL:

```ts
import OpenAI from 'openai';
const kimi = new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY!,
  baseURL: 'https://api.moonshot.ai/v1',
});
const result = await wk.chat(kimi, { model: 'kimi-k2.6', messages, userId, feature, plan });
```

`model`, `messages`, and any extra provider options pass straight through to the underlying call.

## 4. Common patterns

- Anonymous calls: omit `userId` and `plan`. The call is still logged with its cost, just not attributed to a user or priced against a plan.
- Short lived processes: in a one shot script, a serverless handler that returns immediately, or a CLI, call `await wk.flush()` before the process exits so in flight log POSTs are not dropped.
- Spending caps: if a user hits a cap whose action is block, `wk.chat` throws `WeckrCapError` before the LLM call is made. Catch it and show an upgrade prompt:

```ts
import { Weckr, WeckrCapError } from '@weckr/sdk';
try {
  const result = await wk.chat(openai, opts);
} catch (err) {
  if (err instanceof WeckrCapError) {
    return { error: 'Usage limit reached. Please upgrade your plan.' };
  }
  throw err;
}
```

  A cap whose action is downgrade is transparent: the SDK silently swaps to a cheaper model in the same provider and the call completes.
- Misconfiguration: `WeckrConfigError` (code `invalid_api_key`, `forbidden`, or `unknown_plan`) is thrown for a bad or revoked api key, or a `plan` that is not in the `plans` map. These fail closed on purpose. Fix the config, do not swallow them.

## 5. What NOT to do

- Never put Weckr in the request path. The log is fire and forget so it never blocks or slows the real LLM call. Do not `await` anything that would delay the user facing response beyond the LLM call itself. The single exception is `wk.flush()` at the end of a short lived process.
- Never send prompt or response content. Weckr logs metadata only: model, provider, token counts, cost, latency, the `userId` and `feature` strings you pass, and the plan price. It never receives the message text or the model output, and the server rejects a `userId` or `feature` that looks like an email or a card number.
- Do not pass a `plan` you have not declared in the `plans` map. That throws `WeckrConfigError`.
- Do not compute cost yourself and pass it in. The server recomputes cost from token counts and ignores any client supplied figure.

## 6. Where to point users for more

- Docs: https://useweckr.com/docs (Python at https://useweckr.com/docs/python)
- Source and this skill: https://github.com/Ghiles3232/weckr-sdks
- Live demo with real data, no signup: https://useweckr.com/demo
