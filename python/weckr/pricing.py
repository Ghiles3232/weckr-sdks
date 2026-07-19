from __future__ import annotations

"""Per-million-token pricing + cheaper-alternative mapping.

``calculate_cost(model, input_tokens, output_tokens)`` returns USD cost as a
float. Unknown models return 0.0 — server-side recalculation in
/api/v1/log uses the same prefix-match so unknown models can be priced too.

KEEP IN SYNC with:
  - src/pricing.ts             (TypeScript SDK)
  - weckr-api/lib/caps.ts      (server cost recalc)
If you add a model here, add it there too.
"""

from typing import Dict, TypedDict


class ModelPricing(TypedDict):
    input: float
    output: float
    # cache-READ rate per million (discounted repeated context).
    cached_input: float
    # cache-WRITE rate per million. Anthropic charges a premium; for OpenAI/Gemini
    # (no per-request write charge) this equals `input` and is never used, since
    # those providers never report cache-creation tokens.
    cache_write: float


# Per-million-token pricing for supported models.
#
# Cached rates verified against official provider pricing on 2026-07-18:
#   OpenAI gpt-4o + o-series: cache read = 0.5x input.
#   Anthropic (all):          cache read = 0.1x input, 5-min cache write = 1.25x input.
#   Gemini 2.5: cache read = 0.1x input.  Gemini 1.5: cache read = 0.25x input.
PRICING: Dict[str, ModelPricing] = {
    # OpenAI
    "gpt-4o":           {"input": 2.50,  "output": 10.00, "cached_input": 1.25,  "cache_write": 2.50},
    "gpt-4o-mini":      {"input": 0.15,  "output": 0.60,  "cached_input": 0.075, "cache_write": 0.15},
    "gpt-4-turbo":      {"input": 10.00, "output": 30.00, "cached_input": 5.00,  "cache_write": 10.00},
    "gpt-4":            {"input": 30.00, "output": 60.00, "cached_input": 15.00, "cache_write": 30.00},
    "gpt-3.5-turbo":    {"input": 0.50,  "output": 1.50,  "cached_input": 0.25,  "cache_write": 0.50},
    "o1-preview":       {"input": 15.00, "output": 60.00, "cached_input": 7.50,  "cache_write": 15.00},
    "o1-mini":          {"input": 3.00,  "output": 12.00, "cached_input": 1.50,  "cache_write": 3.00},
    # Anthropic. Current flagships (verified 2026-07-19): Opus 4.8/4.7 = 5/25,
    # Sonnet 4.6 = 3/15, Haiku 4.5 = 1/5. "claude-opus-4" keeps the legacy
    # 4.0/4.1 rate (15/75); newer variants get explicit longer-prefix keys.
    "claude-opus-4-8":   {"input": 5.00,  "output": 25.00, "cached_input": 0.50,  "cache_write": 6.25},
    "claude-opus-4-7":   {"input": 5.00,  "output": 25.00, "cached_input": 0.50,  "cache_write": 6.25},
    "claude-opus-4":     {"input": 15.00, "output": 75.00, "cached_input": 1.50,  "cache_write": 18.75},
    "claude-sonnet-4-6": {"input": 3.00,  "output": 15.00, "cached_input": 0.30,  "cache_write": 3.75},
    "claude-sonnet-4":   {"input": 3.00,  "output": 15.00, "cached_input": 0.30,  "cache_write": 3.75},
    "claude-haiku-4-5":  {"input": 1.00,  "output": 5.00,  "cached_input": 0.10,  "cache_write": 1.25},
    "claude-3-5-sonnet": {"input": 3.00, "output": 15.00, "cached_input": 0.30,  "cache_write": 3.75},
    "claude-3-5-haiku": {"input": 0.80,  "output": 4.00,  "cached_input": 0.08,  "cache_write": 1.00},
    "claude-3-opus":    {"input": 15.00, "output": 75.00, "cached_input": 1.50,  "cache_write": 18.75},
    # Gemini
    "gemini-2.5-pro":   {"input": 1.25,  "output": 10.00, "cached_input": 0.125,   "cache_write": 1.25},
    "gemini-2.5-flash": {"input": 0.15,  "output": 0.60,  "cached_input": 0.015,   "cache_write": 0.15},
    "gemini-1.5-pro":   {"input": 1.25,  "output": 5.00,  "cached_input": 0.3125,  "cache_write": 1.25},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30,  "cached_input": 0.01875, "cache_write": 0.075},
}


# Cheaper alternative per model — used when a cap's action is "downgrade".
# Same-provider only; never silently switch a customer to a different vendor.
CHEAPER_ALTERNATIVE: Dict[str, str] = {
    # OpenAI
    "gpt-4o":          "gpt-4o-mini",
    "gpt-4-turbo":     "gpt-4o-mini",
    "gpt-4":           "gpt-4o-mini",
    # Anthropic
    "claude-opus-4-8":   "claude-sonnet-4-6",
    "claude-opus-4-7":   "claude-sonnet-4-6",
    "claude-opus-4":     "claude-sonnet-4",
    "claude-sonnet-4-6": "claude-haiku-4-5",
    "claude-sonnet-4":   "claude-haiku-4-5",
    # Gemini
    "gemini-2.5-pro":  "gemini-2.5-flash",
    "gemini-1.5-pro":  "gemini-2.5-flash",
}


def resolve_pricing(model: str) -> ModelPricing:
    """Resolve pricing for a model name, allowing dated variants.

    Real-world IDs are date-pinned (``gpt-4o-2024-08-06``,
    ``claude-3-5-sonnet-latest``). Strict equality would silently log cost=0
    for those — which neuters every cap. So we longest-prefix-match against
    PRICING: ``claude-3-5-sonnet-20241022`` resolves to ``claude-3-5-sonnet``,
    not the shorter ``claude-3`` family.

    Returns an empty pricing dict ``{"input": 0, "output": 0}`` if no match.
    """
    if model in PRICING:
        return PRICING[model]
    lower = model.lower()
    best_key: str = ""
    best_pricing: ModelPricing = {
        "input": 0.0,
        "output": 0.0,
        "cached_input": 0.0,
        "cache_write": 0.0,
    }
    for key, pricing in PRICING.items():
        if lower.startswith(key.lower()):
            if len(key) > len(best_key):
                best_key = key
                best_pricing = pricing
    return best_pricing


def calculate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cached_input_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    """Return USD cost for ``model`` given token counts.

    Prompt-cache aware. ``cached_input_tokens`` is the cache-READ subset already
    included in ``input_tokens`` (billed at the discounted cached rate);
    ``cache_creation_tokens`` is additive cache-WRITE volume (Anthropic). Both
    default to 0, so callers that don't pass them price exactly as before.

    Unknown models return 0.0 (best-effort; server-side recompute will catch).
    """
    pricing = resolve_pricing(model)
    cached = max(0, min(cached_input_tokens, input_tokens))
    uncached = input_tokens - cached
    cached_rate = pricing.get("cached_input", pricing["input"])
    write_rate = pricing.get("cache_write", pricing["input"])
    return (
        uncached * pricing["input"]
        + cached * cached_rate
        + max(0, cache_creation_tokens) * write_rate
        + output_tokens * pricing["output"]
    ) / 1_000_000.0


__all__ = [
    "ModelPricing",
    "PRICING",
    "CHEAPER_ALTERNATIVE",
    "resolve_pricing",
    "calculate_cost",
]
