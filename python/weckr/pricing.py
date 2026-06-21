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


# Per-million-token pricing for supported models.
PRICING: Dict[str, ModelPricing] = {
    # OpenAI
    "gpt-4o":           {"input": 2.50,  "output": 10.00},
    "gpt-4o-mini":      {"input": 0.15,  "output": 0.60},
    "gpt-4-turbo":      {"input": 10.00, "output": 30.00},
    "gpt-4":            {"input": 30.00, "output": 60.00},
    "gpt-3.5-turbo":    {"input": 0.50,  "output": 1.50},
    "o1-preview":       {"input": 15.00, "output": 60.00},
    "o1-mini":          {"input": 3.00,  "output": 12.00},
    # Anthropic
    "claude-opus-4":    {"input": 15.00, "output": 75.00},
    "claude-sonnet-4":  {"input": 3.00,  "output": 15.00},
    "claude-haiku-4-5": {"input": 0.80,  "output": 4.00},
    "claude-3-5-sonnet": {"input": 3.00, "output": 15.00},
    "claude-3-5-haiku": {"input": 0.80,  "output": 4.00},
    "claude-3-opus":    {"input": 15.00, "output": 75.00},
    # Gemini
    "gemini-2.5-pro":   {"input": 1.25,  "output": 10.00},
    "gemini-2.5-flash": {"input": 0.15,  "output": 0.60},
    "gemini-1.5-pro":   {"input": 1.25,  "output": 5.00},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
}


# Cheaper alternative per model — used when a cap's action is "downgrade".
# Same-provider only; never silently switch a customer to a different vendor.
CHEAPER_ALTERNATIVE: Dict[str, str] = {
    # OpenAI
    "gpt-4o":          "gpt-4o-mini",
    "gpt-4-turbo":     "gpt-4o-mini",
    "gpt-4":           "gpt-4o-mini",
    # Anthropic
    "claude-opus-4":   "claude-sonnet-4",
    "claude-sonnet-4": "claude-haiku-4-5",
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
    best_pricing: ModelPricing = {"input": 0.0, "output": 0.0}
    for key, pricing in PRICING.items():
        if lower.startswith(key.lower()):
            if len(key) > len(best_key):
                best_key = key
                best_pricing = pricing
    return best_pricing


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return USD cost for ``model`` given input/output token counts.

    Unknown models return 0.0 (best-effort; server-side recompute will catch).
    """
    pricing = resolve_pricing(model)
    return (
        input_tokens * pricing["input"] + output_tokens * pricing["output"]
    ) / 1_000_000.0


__all__ = [
    "ModelPricing",
    "PRICING",
    "CHEAPER_ALTERNATIVE",
    "resolve_pricing",
    "calculate_cost",
]
