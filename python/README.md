# weckr-sdk

AI cost and margin intelligence for SaaS founders. See exactly which users
cost more than they pay — per LLM call, zero added latency. The Python
counterpart of the TypeScript [`@weckr/sdk`](https://www.npmjs.com/package/@weckr/sdk).

## Install

```bash
pip install weckr-sdk
```

Zero runtime dependencies. Bring your own LLM SDK:

```bash
pip install weckr-sdk openai            # for OpenAI
pip install weckr-sdk anthropic         # for Anthropic
pip install weckr-sdk google-genai      # for Gemini (new SDK)
# or all at once:
pip install "weckr-sdk[all]"
```

## Quick start

```python
import os
from openai import OpenAI
from weckr import Weckr

openai_client = OpenAI()  # reads OPENAI_API_KEY from env

wk = Weckr(
    api_key=os.environ["WK_API_KEY"],
    plans={"free": 0, "pro": 29, "business": 99},
)

result = wk.chat(
    openai_client,
    {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Summarize this."}],
        "user_id": user.id,
        "feature": "ai-summary",
        "plan": user.plan,
    },
)
print(result.choices[0].message.content)
```

The original LLM call runs unchanged and returns the original result. After it
resolves, Weckr fires an async log POST to the Weckr API on a background
thread — fire-and-forget, never blocks your request path.

## Anthropic

```python
from anthropic import Anthropic
from weckr import Weckr

anthropic_client = Anthropic()
wk = Weckr(api_key=os.environ["WK_API_KEY"], plans={"pro": 29})

msg = wk.chat(
    anthropic_client,
    {
        "model": "claude-sonnet-4",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Hello!"}],
        "user_id": user.id,
        "plan": "pro",
    },
)
```

## Gemini

```python
from google import genai
from weckr import Weckr

genai_client = genai.Client()
wk = Weckr(api_key=os.environ["WK_API_KEY"], plans={"pro": 29})

resp = wk.chat(
    genai_client,
    {
        "model": "gemini-2.5-flash",
        "messages": [{"role": "user", "content": "Hello!"}],
        "user_id": user.id,
        "plan": "pro",
    },
)
```

## Caps + downgrades

Set per-plan spending caps in the dashboard. When a user crosses their cap:

- **`action: "block"`** — `wk.chat()` raises `WeckrCapError` and the LLM call
  is never made.
- **`action: "downgrade"`** — the SDK silently swaps the model for a
  cheaper one in the same provider (`gpt-4o` → `gpt-4o-mini`,
  `claude-opus-4` → `claude-sonnet-4`, etc.) and emits a one-time
  `WeckrDowngradeWarning` per (user, model) pair.

```python
from weckr import Weckr, WeckrCapError, WeckrConfigError

try:
    wk.chat(openai_client, {...})
except WeckrCapError as e:
    show_upgrade_prompt(e.user_id, e.cap)
except WeckrConfigError as e:
    # Typo'd api key, revoked key, or `plan` not in the plans dict —
    # fail-CLOSED so cap enforcement isn't silently disabled.
    alert_backend_team(e.code, str(e))
```

## Short-lived processes (Lambda, cron, CLI)

`wk.chat()` returns as soon as the LLM call resolves; the log POST runs on a
daemon thread. In short-lived processes — Lambda, cron jobs, CLI scripts —
call `wk.flush()` before exit so the daemon thread isn't torn down mid-POST:

```python
wk.chat(openai_client, {...})
wk.flush()      # default 5s timeout
```

## What gets logged

Every successful call (and every failed LLM call) lands in the dashboard:

```python
{
    "userId":         "u_42",
    "feature":        "ai-summary",
    "model":          "gpt-4o-mini",
    "provider":       "openai",
    "inputTokens":    12,
    "outputTokens":   2,
    "costUsd":        0.000003,
    "latencyMs":      1218,
    "planName":       "pro",
    "planRevenueUsd": 29.0,
    "timestamp":      "2026-06-15T07:52:18.086515+00:00",
}
```

Cost is recomputed server-side from `(model, input_tokens, output_tokens)` —
clients cannot forge cost values. Margin is `planRevenueUsd - costUsd`
(negative means you're losing money on that user); the dashboard derives it
on read from `SUM(revenue) - SUM(cost)` for full precision.

## Supported models

- **OpenAI** — `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`,
  `gpt-3.5-turbo`, `o1-preview`, `o1-mini`
- **Anthropic** — `claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4-5`,
  `claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-3-opus`
- **Gemini** — `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-1.5-pro`,
  `gemini-1.5-flash`

Dated variants (`gpt-4o-2024-08-06`, `claude-3-5-sonnet-latest`, …) resolve
to the matching family by longest-prefix lookup.

## Dashboard

View cost / margin / per-user / per-feature breakdowns at
[https://app.useweckr.com/dashboard](https://app.useweckr.com/dashboard).

## License

MIT
