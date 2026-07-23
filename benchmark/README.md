# Weckr Task Cost Benchmark

What 10 real product features actually cost across OpenAI, Anthropic, Gemini, and Kimi.
Not price per token, real task cost.

Published results: **https://useweckr.com/benchmark**

Most public comparisons measure raw price per million tokens or academic capability scores.
Neither tells you what a feature costs to run. This suite measures that: ten realistic
application tasks, run against each provider's live API, priced with the same pricing table
Weckr uses to recompute cost on every logged call.

Everything needed to reproduce or audit the run is in this folder. A cost tracking company
publishing a cost benchmark should be checkable, so the prompts, the runner, and every raw
response are all here.

## Results, run 2026-07-23 (suite v1.0.0)

Cost in USD for one run of each task. All four providers ran. 40 of 40 task runs completed,
none failed, none truncated by the output cap.

| Task | OpenAI `gpt-5.4-mini` | Anthropic `claude-haiku-4-5` | Gemini `gemini-3.6-flash` | Kimi `kimi-k2.6` |
| --- | ---: | ---: | ---: | ---: |
| Customer support reply | 0.000935 | 0.001186 | 0.010224 | 0.005585 |
| Ticket classification | 0.000083 | 0.000108 | 0.001610 | 0.000478 |
| Receipt extraction | 0.000395 | 0.000590 | 0.012957 | 0.023550 |
| Product description | 0.000654 | 0.000887 | 0.023360 | 0.007518 |
| RAG style question answering | 0.000475 | 0.000766 | 0.004923 | 0.001368 |
| Tone rewrite | 0.000605 | 0.000710 | 0.012833 | 0.002741 |
| Code test generation | 0.001041 | 0.002598 | 0.016774 | 0.029093 |
| Multi turn support conversation (3 calls) | 0.002560 | 0.003537 | 0.016302 | 0.010794 |
| Long document summarization | 0.004363 | 0.006074 | 0.023277 | 0.008368 |
| Agentic multi step task (4 calls) | 0.002909 | 0.005101 | 0.026094 | 0.025969 |
| **All 10 tasks** | **0.014020** | **0.021557** | **0.148354** | **0.115464** |

### What the numbers show

The full suite costs **10.6 times more on Gemini than on OpenAI**. The published rates for these
four models span only 2.0 times on input and 1.9 times on output, so almost none of that spread is
the sticker price. It is how many tokens each model chose to spend.

The clearest case is classification. The correct answer is the single word `billing`, and all four
models got it right:

| Provider | Output tokens | Of which thinking | Answer |
| --- | ---: | ---: | --- |
| OpenAI | 4 | 0 | `billing` |
| Anthropic | 4 | 0 | `billing` |
| Kimi | 116 | 113 | `billing` |
| Gemini | 198 | 197 | `billing` |

Thinking tokens are billed at the output rate, so the same one word answer costs **19.4 times more
on Gemini than on OpenAI**. No per million token price list shows you that.

Compounding is the second effect. The agentic task plans and then executes across four calls, each
resending everything before it. Relative to the single turn support reply on the identical model at
the identical rate, it costs 3.1 times more on OpenAI, 4.3 times on Anthropic, 2.6 times on Gemini,
and 4.7 times on Kimi.

The top of the ranking was stable in this run. OpenAI was cheapest on all ten tasks and Anthropic
second on all ten. What moved was the bottom half: Kimi and Gemini traded third and fourth place
depending on the task, with Kimi the most expensive of the four on receipt extraction and code test
generation and third elsewhere.

So the useful reading is not the leaderboard, which one pricing update can rearrange. It is the size
of the gap. Ten identical pieces of work cost 10.6 times more at one end than the other, on models
whose published rates differ by less than 2 times. That gap is produced by model behaviour rather
than by price, and it is invisible until you measure the task.

## The 10 tasks

Full prompt text is in [`tasks.json`](./tasks.json).

1. **Customer support reply.** Generate a reply to a support ticket given short account context.
2. **Ticket classification.** Classify a support message into one of five categories.
3. **Receipt extraction.** Pull structured fields from messy realistic receipt text.
4. **Product description.** Write a short product description from five bullet points.
5. **RAG style question answering.** Answer a question using only a provided context chunk.
6. **Tone rewrite.** Rewrite a formal paragraph into a casual one.
7. **Code test generation.** Write three test cases for a given function signature.
8. **Multi turn support conversation.** Three exchanges where context accumulates each turn.
9. **Long document summarization.** Summarize a 3,047 word document ([`fixtures/long-document.md`](./fixtures/long-document.md)) into a short summary.
10. **Agentic multi step task.** Plan, then execute the plan across three steps with full context carried forward.

Tasks 8 and 10 resend the whole accumulated conversation on every call, which is how a real
multi turn or agentic feature behaves. Their cost is the sum of every call.

## Methodology

**Model tier.** One tier per provider: the fast, cost optimized tier, which is the tier most SaaS
features actually run on in production. These are not the flagship reasoning models. Comparing
flagships would measure something real but different, and it is not what a high volume product
feature is usually built on. The exception is Kimi K2.6, which serves as Moonshot's primary tier
rather than a cheaper sibling of a larger model, because Moonshot does not currently offer a
separate economy model in the way the other three do.

| Provider | Model | Per 1M in / out |
| --- | --- | ---: |
| OpenAI | `gpt-5.4-mini` | $0.75 / $4.50 |
| Anthropic | `claude-haiku-4-5` | $1.00 / $5.00 |
| Gemini | `gemini-3.6-flash` | $1.50 / $7.50 |
| Kimi | `kimi-k2.6` | $0.95 / $4.00 |

Each identifier was verified against that provider's live model list on the run date.
`claude-haiku-4-5` is an alias that the API resolves to `claude-haiku-4-5-20251001`.

**Settings.** Provider defaults. No reasoning effort, thinking budget, temperature, or sampling
parameter is set anywhere in this suite. Only a per task max output token cap is sent, currently
8,192, set high enough that no run in the published results was truncated. This is deliberate. It is
what a feature costs if you simply call the API, and the providers do not expose matching thinking
controls, so any attempt to equalise them would mean deciding which rungs count as equivalent, and
that decision would quietly pick the winner.

**Tokens.** Input and output counts come from each provider's own API response and are never
estimated locally. Thinking and reasoning tokens are included in output tokens because that is how
they are billed. They are also broken out separately in the results so you can see them.

**Pricing.** Cost is computed from the `PRICING` table in Weckr's `lib/caps.ts`, the same table and
the same formula the `/log` route uses to recompute cost server side for real customer traffic. The
benchmark cannot flatter Weckr by pricing differently from the product.

**Missing providers.** A provider with no usable API key is skipped and reported. It is never
estimated and never written into the results as though it ran. No provider was skipped in this run.

**Truncation.** The runner records each provider's stop reason and flags any run that hit the output
cap, because a truncated run understates the real cost. If a model spends its entire output budget
on reasoning without producing an answer, that run is failed with an explicit reason rather than
recorded as a cheap success. This is not hypothetical: at a 4,096 token cap, Kimi did exactly that on
the code test task, which is why the cap is now 8,192.

**Limitations.** Single run per task, not an average of several, so treat small differences as
noise and large ones as signal. Models vary run to run in how long they think, and the two heaviest
thinkers here vary a lot. One model tier per provider. Cost only, not quality: this measures what a
task costs, not how good the answer is. Provider pricing and default behaviour both change often,
which is why every run is kept with its date.

## Reproducing the run

Requires Node 24 or newer, which strips TypeScript types natively so there is no build step and no
dependency to install. Every provider is called over plain `fetch`, so the exact HTTP request is
readable in [`run.ts`](./run.ts).

```bash
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GEMINI_API_KEY=...
export MOONSHOT_API_KEY=...

node run.ts                          # all tasks, all providers with a key
node run.ts --only openai,kimi       # a subset of providers
node run.ts --task support-reply     # a single task
node run.ts --dry-run                # print the plan and key readiness, no API calls
node run.ts --env-file ./my.env      # load keys from a dotenv style file
```

Kimi is called through the OpenAI compatible endpoint at `https://api.moonshot.ai/v1`, the same
pattern as the rest of the Weckr Kimi integration.

Providers without a key are skipped with a clear warning and the run continues. Results are written
to `results/<date>.json` and `results/latest.json`.

Note: `run.ts` imports Weckr's pricing table from the main application repository
(`../../lib/caps.ts`). That path resolves inside the Weckr app repo where the runner lives. This
copy is published for auditing the exact code that produced the results; to run it standalone,
point that import at your own pricing source.

## Results format

`results/latest.json` contains the full run: the suite version, the run timestamp, per provider
model and status including the reason any provider was skipped, and one entry per task and provider
with input tokens, output tokens, cached tokens, reasoning tokens, computed cost, latency, the stop
reason, a truncation flag, and the complete text of every response.

## Versioning

This is suite v1.0.0. The task set is deliberately small and will expand. Task prompts are frozen
per version so results stay comparable across runs. A change to any prompt bumps the suite version.

---

Built by [Weckr](https://useweckr.com), AI cost and margin intelligence for SaaS founders.
Weckr shows you cost and margin per user and per feature in your own application, which is the
same question this benchmark asks, applied to your real traffic instead of synthetic tasks.
