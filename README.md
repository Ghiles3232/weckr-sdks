# Weckr SDKs

AI cost and margin intelligence for SaaS founders — see exactly which users cost you more than they pay, per LLM call, zero added latency.

Drop the SDK into your app, get a dashboard that shows cost per user / feature / model and recommends cheaper swaps. Set per-plan spending caps the SDK enforces before the LLM call.

## Pick your language

| | Package | Install | Source |
|---|---|---|---|
| **TypeScript / Node** | [`@weckr/sdk`](https://www.npmjs.com/package/@weckr/sdk) | `npm install @weckr/sdk` | [`typescript/`](./typescript) |
| **Python** | [`weckr-sdk`](https://pypi.org/project/weckr-sdk/) | `pip install weckr-sdk` | [`python/`](./python) |
| **Claude / Cursor (MCP)** | [`@weckr/mcp`](https://www.npmjs.com/package/@weckr/mcp) | `npx -y @weckr/mcp` | [`mcp/`](./mcp) |

Each subfolder has full setup docs, examples, and supported-model lists.

## Try it without signing up

[**Live demo dashboard →**](https://app.useweckr.com/demo)

Click around with seeded data for a fictional SaaS — no signup required.

## How it works

1. You wrap your LLM calls with `wk.chat(client, opts)`.
2. The SDK forwards the call to OpenAI / Anthropic / Gemini and returns the original result — no added latency on the request path.
3. After it resolves, the SDK fire-and-forgets a log to the Weckr API with `(userId, feature, model, tokens, latency, plan)`.
4. The backend computes cost server-side from public per-token pricing (clients can't forge cost) and stores `(cost, revenue, margin)` per request.
5. The dashboard rolls it up — per user, per feature, per model — and surfaces unprofitable users + cheaper-model recommendations.

## What gets sent

Only the call metadata above — model name, token counts, latency, plan, and your `userId` string. **No prompt text or completion text is ever sent.**

## Get an API key

[app.useweckr.com](https://app.useweckr.com) — free tier, no credit card.

## License

MIT — see [LICENSE](./LICENSE).
