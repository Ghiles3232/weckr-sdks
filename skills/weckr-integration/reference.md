# Weckr SDK reference

Fuller API surface for the Weckr SDK. Read this when the two line pattern in SKILL.md is not enough: to check every constructor option, every `wk.chat` field, the exact error types, or the full provider matrix. Everything here matches the shipped `@weckr/sdk` (TypeScript) and `weckr-sdk` (Python).

## Packages

- TypeScript / JavaScript: `npm install @weckr/sdk`
- Python: `pip install weckr-sdk`

## Constructor: `new Weckr(config)`

`config` (WeckrConfig):

- `apiKey` (string, required): your `wk_` project key from the dashboard.
- `plans` (Record of plan name to monthly USD price, optional): required only if you pass `plan` to `wk.chat`. Example `{ free: 0, pro: 29, business: 99 }`. The `plan` on a call must be a key here.
- `disableCapCheck` (boolean, optional): off by default. When on, the SDK skips the `/api/v1/check` cap lookup before each call.
- `endpoint` (string, optional): override the log ingest URL. Defaults to the hosted endpoint.
- `checkEndpoint` (string, optional): override the cap check URL. Derived from `endpoint` by default.
- `fetch` (function, optional): inject a custom fetch implementation.
- `onError` (function, optional): receives async errors (a cap check network failure, a log POST failure). If absent these are swallowed. Note: critical config errors (bad key, unknown plan) still throw synchronously regardless.
- `onDowngrade` (function, optional): called as `{ userId, from, to }` when a cap downgrade swaps the model. Defaults to a one time console warning per user and swap.

## Method: `wk.chat(client, options)`

Returns the underlying provider result unchanged (a Promise of it). `client` is the provider client instance. `options` (ChatOptions):

- `model` (string, required).
- `messages` (array of `{ role, content }`, required): passed straight through to the provider.
- `userId` (string, optional): the end user this call is for. Omit for an anonymous call.
- `feature` (string, optional): a label for the product surface, for example `ai-summary`. Omit if not slicing by feature.
- `plan` (string, optional): the end user's plan name. Must be a key in the constructor `plans` map or `WeckrConfigError` is thrown.
- `stream` (boolean, optional): OpenAI streaming opt in.
- Any additional provider options (for example `max_tokens`, `temperature`) pass through to the underlying call.

## Method: `wk.chatWithEventId(client, options)`

Same call, but resolves to `{ result, eventId }`. Use it when you want to correlate a specific call to its dashboard row, for example in a support flow ("which call was that?"). The `eventId` is a client generated UUID that the server also uses to dedupe retries.

## Method: `wk.flush(timeoutMs?)`

Awaits all in flight log POSTs. Call it before `process.exit`, before returning from a short lived serverless handler, or at the end of a CLI run, otherwise the process can be torn down before a fire and forget log reaches the network.

## Errors

Both are exported from `@weckr/sdk`.

- `WeckrCapError`: thrown by `wk.chat` when a spending cap is hit and its action is `block`. The LLM call is never made. Fields: `userId`, `planName`, and optionally `currentSpend` and `cap`. Detect with `err instanceof WeckrCapError` or the exported `isWeckrCapError(err)`.
- `WeckrConfigError`: thrown for an unrecoverable config problem. Field `code` is one of `invalid_api_key` (401), `forbidden` (403, revoked key), or `unknown_plan` (a `plan` not in the `plans` map). These fail closed on purpose, because failing open would silently disable cap enforcement or poison dashboard data. Detect with `isWeckrConfigError(err)`.

## Cap check behavior

When cap checking is on (the default) and both `userId` and `plan` are present, the SDK calls `/api/v1/check` before the LLM call, cached per user and plan for 60 seconds. Outcomes:

- Allowed: the call proceeds normally.
- Blocked (`action: "block"`): `WeckrCapError` is thrown, no LLM call.
- Downgrade (`action: "downgrade"`): the SDK silently swaps to a cheaper model in the same provider and the call proceeds. `onDowngrade` fires.

The cap check fails OPEN on a Weckr outage or network error (a monitoring outage must never break the customer's app), but fails CLOSED on 401 or 403 (a broken key surfaces as `WeckrConfigError` rather than silently disabling the control).

## What is logged, and what is never logged

Logged per call: `userId`, `feature`, `model`, `provider`, input and output token counts, cache read and cache write token counts, `costUsd` (recomputed server side from tokens, the client value is ignored), `latencyMs`, `planName`, and the plan revenue.

Never logged: prompt text, message content, or model output. The server also rejects a `userId` or `feature` that looks like an email address or a card number, returning a 400 that asks the caller to hash or pseudonymise.

## Provider matrix

Supported providers: `openai`, `anthropic`, `gemini`, `kimi`. Detection is by client shape, or by base URL for Kimi. An undetected client still logs, but cost and downgrade fall back to no ops.

OpenAI:

```ts
import OpenAI from 'openai';
const openai = new OpenAI();
await wk.chat(openai, { model: 'gpt-5.4-mini', messages, userId, feature, plan });
```

Anthropic:

```ts
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic();
await wk.chat(anthropic, { model: 'claude-sonnet-4-6', max_tokens: 1024, messages, userId, feature, plan });
```

Gemini (new `@google/genai` client recommended; the legacy `@google/generative-ai` client is also detected):

```ts
import { GoogleGenAI } from '@google/genai';
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
await wk.chat(gemini, { model: 'gemini-3.6-flash', messages, userId, feature, plan });
```

Kimi (Moonshot AI), OpenAI compatible via base URL:

```ts
import OpenAI from 'openai';
const kimi = new OpenAI({ apiKey: process.env.MOONSHOT_API_KEY!, baseURL: 'https://api.moonshot.ai/v1' });
await wk.chat(kimi, { model: 'kimi-k2.6', messages, userId, feature, plan });
```

Dated or suffixed model variants resolve to the closest match by prefix, so `gpt-5.4-mini-2026-05-01` prices as `gpt-5.4-mini`.

## Python SDK

Same shape, snake_case keys. Note `user_id`, not `userId`:

```python
from openai import OpenAI
from weckr import Weckr, WeckrCapError

openai_client = OpenAI()
wk = Weckr(api_key=os.environ['WECKR_API_KEY'], plans={'free': 0, 'pro': 29})

result = wk.chat(openai_client, {
    'model': 'gpt-5.4-mini',
    'messages': [{'role': 'user', 'content': prompt}],
    'user_id': user.id,
    'feature': 'ai-summary',
    'plan': user.plan,
})
```

## Pricing utilities

Exported for cost math without a live call: `PRICING` (the price table), `resolvePricing(model)` (resolves a dated variant to its family), and `calculateCost(model, inputTokens, outputTokens)` (returns `{ costUsd, provider }`).

## Links

- Docs: https://useweckr.com/docs
- Python docs: https://useweckr.com/docs/python
- Source: https://github.com/Ghiles3232/weckr-sdks
- Live demo: https://useweckr.com/demo
