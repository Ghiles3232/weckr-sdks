# Weckr SDKs

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/14084/badge)](https://www.bestpractices.dev/projects/14084)
[![CI](https://github.com/Ghiles3232/weckr-sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/Ghiles3232/weckr-sdks/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Ghiles3232/weckr-sdks/badge)](https://api.securityscorecards.dev/projects/github.com/Ghiles3232/weckr-sdks)

AI cost and margin intelligence for SaaS founders. See exactly which users cost you more than they pay, per LLM call, zero added latency.

Drop the SDK into your app, get a dashboard that shows cost per user / feature / model and recommends cheaper swaps. Set per-plan spending caps the SDK enforces before the LLM call.

## Pick your language

| | Package | Install | Source |
|---|---|---|---|
| **TypeScript / Node** | [`@weckr/sdk`](https://www.npmjs.com/package/@weckr/sdk) | `npm install @weckr/sdk` | [`typescript/`](./typescript) |
| **Python** | [`weckr-sdk`](https://pypi.org/project/weckr-sdk/) | `pip install weckr-sdk` | [`python/`](./python) |
| **Claude / Cursor (MCP)** | [`@weckr/mcp`](https://www.npmjs.com/package/@weckr/mcp) | `npx -y @weckr/mcp` | [`mcp/`](./mcp) |
| **Claude Code (Skills)** | `weckr` plugin | `/plugin install weckr@weckr` | [`skills/`](./skills) |

Each subfolder has full setup docs, examples, and supported-model lists.

## Claude Skills

This repo is also an installable Claude Code plugin that bundles four skills, so your AI assistant knows real model prices and the exact Weckr syntax instead of inventing code:

```
/plugin marketplace add Ghiles3232/weckr-sdks
/plugin install weckr@weckr
```

| Skill | What Claude learns |
|---|---|
| [`weckr-integration`](./skills/weckr-integration) | Wire the SDK in with the correct two line pattern, errors, and provider notes |
| [`weckr-model-pricing`](./skills/weckr-model-pricing) | Current per token prices for OpenAI, Anthropic, Gemini, and Kimi |
| [`weckr-cost-estimator`](./skills/weckr-cost-estimator) | Project what an AI feature costs per call, per user, per month before shipping |
| [`weckr-margin-audit`](./skills/weckr-margin-audit) | Flag which pricing plans go underwater once LLM cost is counted |

The pricing skills read the live feed at [useweckr.com/pricing.json](https://useweckr.com/pricing.json) first (generated from the same table Weckr bills with), and a weekly [pricing watcher](./scripts/pricing-watch) opens a reviewed PR whenever a provider changes rates, so the numbers track reality instead of drifting. Full explainer at [useweckr.com/skills](https://useweckr.com/skills).

## Try it without signing up

[**Live demo dashboard →**](https://app.useweckr.com/demo)

Click around with seeded data for a fictional SaaS. No signup required.

## Starter templates

Clone a full AI SaaS with Weckr already wired in and deploy in minutes. Both are MIT licensed.

* [weckr-nextjs-starter](https://github.com/Ghiles3232/weckr-nextjs-starter): Next.js 14, Supabase auth, Stripe billing, an OpenAI endpoint, and Weckr tracking cost and margin per user.
* [weckr-fastapi-starter](https://github.com/Ghiles3232/weckr-fastapi-starter): FastAPI, a Claude endpoint, SQLite, and Weckr tracking cost and margin per user.

## Framework guides

Step by step integrations for the stacks people actually ship on, each with the exact code and where the wrap goes:

* [Next.js](https://useweckr.com/how-to/nextjs-llm-cost-tracking): route handler pattern, `flush()` for serverless, streaming notes.
* [FastAPI](https://useweckr.com/how-to/fastapi-llm-cost-tracking): endpoint pattern with the authenticated user, zero added dependencies.
* [LangChain](https://useweckr.com/how-to/langchain-cost-tracking-per-user): wrap the client at the boundary, not the callbacks.
* [CrewAI](https://useweckr.com/how-to/crewai-agent-cost-tracking): price every agent turn, catch the stuck crew.

## How it works

1. You wrap your LLM calls with `wk.chat(client, opts)`.
2. The SDK forwards the call to OpenAI / Anthropic / Gemini and returns the original result, with no added latency on the request path.
3. After it resolves, the SDK fire-and-forgets a log to the Weckr API with `(userId, feature, model, tokens, latency, plan)`.
4. The backend computes cost server-side from public per-token pricing (clients can't forge cost) and stores `(cost, revenue, margin)` per request.
5. The dashboard rolls it up, per user, per feature, per model, and surfaces unprofitable users + cheaper-model recommendations.

## What gets sent

Only the call metadata above: model name, token counts, latency, plan, and your `userId` string. **No prompt text or completion text is ever sent.**

## Get an API key

[app.useweckr.com](https://app.useweckr.com). Free tier, no credit card.

## Questions and Support

Have a question about integration or a feature request?
Open a discussion: https://github.com/Ghiles3232/weckr-sdks/discussions

We respond to every question.

## License

MIT. See [LICENSE](./LICENSE).
