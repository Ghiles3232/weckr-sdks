# Security Policy

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public issue for anything security sensitive.

- Email: **aghilesasmani@gmail.com** with subject line starting `[SECURITY]`
- Or use GitHub&rsquo;s [private vulnerability reporting](https://github.com/Ghiles3232/weckr-sdks/security/advisories/new) on this repository.

You will get an initial response within **7 days** (usually much faster). Please include reproduction steps and the affected package and version. If the report is valid, a fix is developed privately, released to npm/PyPI, and credited to you in the changelog unless you prefer otherwise.

## Supported versions

The latest published versions of `@weckr/sdk` (npm) and `weckr-sdk` (PyPI) receive security fixes. Older versions should upgrade; the SDKs have no breaking changes within a minor line.

## Scope and design notes for researchers

Things worth knowing when assessing these SDKs:

- The SDKs transmit **metadata only**: model, provider, token counts, latency, a user identifier, feature label, and plan price. Prompt and completion text are never sent, and the API rejects user identifiers that look like emails or card numbers.
- Cost is **recomputed server side** from token counts; client supplied cost figures are ignored, so a compromised client cannot forge its own spend.
- Logging is **fire and forget** after the LLM call and fails open: an outage of Weckr cannot block or slow the host application. Auth errors fail closed by design.
- API keys are 128 bit random (`wk_` prefix), scoped to a single project, rotatable from the dashboard.

Reports about the hosted service at useweckr.com are also welcome at the same address.
