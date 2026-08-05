# Pricing watch (SDK + skills)

Weekly check that the SDK price tables and the pricing skill stay in step with
real provider prices. Mirror of the watcher in the private weckr-api repo, which
watches the server-side billing table (`lib/caps.ts`).

## What it watches

From `targets.weckr-sdks.json`:

- `typescript/src/pricing.ts` (TS SDK price table)
- `python/weckr/pricing.py` (Python SDK price table)
- `skills/weckr-model-pricing/SKILL.md` and `reference.md` (price tables)
- `skills/weckr-cost-estimator/SKILL.md` (common-prices table)

## How it works

`.github/workflows/pricing-watch.yml` runs weekly (Mondays 09:00 UTC) and on
demand. `check.mjs` diffs each table against a public, deterministic pricing
dataset (LiteLLM's `model_prices_and_context_window.json`): plain JSON, no API
key, no model in the loop. If a table drifted, it edits only the changed numbers
and opens a PR for review. Nothing is committed to a price table without review.

Guards: alias models (`-latest`) are skipped; a proposed change to `0` is skipped
(dataset hole); cache-write is compared only for Anthropic.

## Setup (one-time)

- Settings, Actions, General, Workflow permissions: enable "Allow GitHub Actions
  to create and approve pull requests". No secret is required.

## After merging

Mirror any change the private repo's watcher applies to `lib/caps.ts`, and
republish the SDKs so installed users get the corrected prices.

## Local dry run

```bash
echo '{ "gpt-5.4-mini": { "output": 5.0 } }' > /tmp/ref.json
node scripts/pricing-watch/check.mjs --file typescript/src/pricing.ts --format sdk-ts --source /tmp/ref.json
```
