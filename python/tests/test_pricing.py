from __future__ import annotations

import pytest

from weckr.pricing import CHEAPER_ALTERNATIVE, PRICING, calculate_cost, resolve_pricing


def test_calculate_cost_gpt_4o_mini():
    # gpt-4o-mini: 0.15/M input, 0.60/M output
    # 12 input + 2 output = (12*0.15 + 2*0.60)/1e6 = 3e-6
    assert calculate_cost("gpt-4o-mini", 12, 2) == pytest.approx(0.000003, abs=1e-9)


def test_calculate_cost_gpt_4o_one_million():
    # gpt-4o: 2.50/M input, 10.00/M output
    # 1M input + 1M output = 2.50 + 10.00 = 12.50
    assert calculate_cost("gpt-4o", 1_000_000, 1_000_000) == pytest.approx(12.5, abs=1e-6)


def test_calculate_cost_unknown_model_returns_zero():
    assert calculate_cost("unknown-model", 100, 100) == 0.0


def test_pricing_contains_all_spec_models():
    expected = {
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
        "claude-opus-4",
        "claude-sonnet-4",
        "claude-haiku-4-5",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
    }
    for model in expected:
        assert model in PRICING, f"missing model in PRICING: {model}"


def test_cheaper_alternative_mappings():
    # Spec mappings — same-provider only
    assert CHEAPER_ALTERNATIVE["gpt-4o"] == "gpt-4o-mini"
    assert CHEAPER_ALTERNATIVE["gpt-4-turbo"] == "gpt-4o-mini"
    assert CHEAPER_ALTERNATIVE["gpt-4"] == "gpt-4o-mini"
    assert CHEAPER_ALTERNATIVE["claude-opus-4"] == "claude-sonnet-4"
    assert CHEAPER_ALTERNATIVE["claude-sonnet-4"] == "claude-haiku-4-5"
    assert CHEAPER_ALTERNATIVE["gemini-2.5-pro"] == "gemini-2.5-flash"
    assert CHEAPER_ALTERNATIVE["gemini-1.5-pro"] == "gemini-2.5-flash"


def test_pricing_dict_shape():
    """Spec uses {'input': ..., 'output': ...} keys — not 'inputPerMillion'."""
    sample = PRICING["gpt-4o"]
    assert "input" in sample and "output" in sample
    assert sample["input"] == 2.50 and sample["output"] == 10.00


def test_resolve_pricing_dated_variant_uses_prefix():
    """REGRESSION: 'gpt-4o-2024-08-06' must resolve to gpt-4o pricing,
    not silently log $0."""
    p = resolve_pricing("gpt-4o-2024-08-06")
    assert p["input"] == 2.50
    assert p["output"] == 10.00


def test_resolve_pricing_claude_dated_latest():
    """REGRESSION: 'claude-3-5-sonnet-latest' must longest-prefix to
    'claude-3-5-sonnet', not to 'claude-3' (which doesn't exist) or
    'claude-3-opus'."""
    p = resolve_pricing("claude-3-5-sonnet-latest")
    assert p["input"] == 3.00
    assert p["output"] == 15.00


def test_resolve_pricing_unknown_returns_zero():
    p = resolve_pricing("totally-unknown-model-xyz")
    assert p["input"] == 0.0
    assert p["output"] == 0.0


def test_calculate_cost_dated_variant():
    """End-to-end: dated variant computes positive cost via prefix lookup."""
    # 12 input * 2.50/M + 2 output * 10/M = 30e-6 + 20e-6 = 50e-6
    cost = calculate_cost("gpt-4o-2024-08-06", 12, 2)
    assert cost == pytest.approx(0.00005, abs=1e-9)


# ---------- prompt-cache pricing ----------


def test_pricing_has_cached_rates():
    """Every model carries a cached_input discount <= its input rate."""
    for model, p in PRICING.items():
        assert p["cached_input"] > 0, f"{model} missing cached_input"
        assert p["cached_input"] <= p["input"], f"{model} cached_input not a discount"


def test_calculate_cost_with_cache_openai():
    # gpt-4o: input 2.5, output 10, cached 1.25. 1000 in (600 cached) + 500 out.
    # 400*2.5 + 600*1.25 + 500*10 = 1000 + 750 + 5000 = 6750 /1e6
    assert calculate_cost("gpt-4o", 1000, 500, 600, 0) == pytest.approx(0.00675, abs=1e-9)


def test_calculate_cost_with_cache_anthropic_write():
    # claude-sonnet-4: input 3, output 15, cached 0.3, write 3.75.
    # 400*3 + 600*0.3 + 300*3.75 + 200*15 = 1200 + 180 + 1125 + 3000 = 5505 /1e6
    assert calculate_cost("claude-sonnet-4", 1000, 200, 600, 300) == pytest.approx(
        0.005505, abs=1e-9
    )


def test_calculate_cost_full_cache_gemini():
    # gemini-2.5-flash: input 0.30, output 2.50, cached 0.03. all 2000 cached + 300 out.
    # 2000*0.03 + 300*2.50 = 60 + 750 = 810 /1e6
    assert calculate_cost("gemini-2.5-flash", 2000, 300, 2000, 0) == pytest.approx(
        0.00081, abs=1e-9
    )


def test_calculate_cost_cache_defaults_backward_compatible():
    # Omitting the cache args must equal the pre-cache result.
    assert calculate_cost("gpt-4o", 1000, 500) == calculate_cost("gpt-4o", 1000, 500, 0, 0)

