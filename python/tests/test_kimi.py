from __future__ import annotations

"""Behavior tests for Kimi (Moonshot AI) provider support.

Covers: response parsing, cost calculation (hand-calculated), provider
detection across several client configs, fail-open on logging failure, and an
end-to-end pass through wk.chat that asserts the logged payload.
"""

from collections import namedtuple
from unittest.mock import MagicMock

import pytest

from weckr import Weckr
from weckr.cap import CapCheckResult
from weckr.normalize import detect_provider, normalize_usage
from weckr.pricing import PRICING, CHEAPER_ALTERNATIVE, calculate_cost, resolve_pricing


# ---------- helpers ----------


def _kimi_response(prompt_tokens=1200, completion_tokens=300, cached=400):
    """A realistic Moonshot (Kimi) chat completion, OpenAI compatible shape."""
    Details = namedtuple("Details", ["cached_tokens"])
    Usage = namedtuple(
        "Usage",
        ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_tokens_details"],
    )
    Msg = namedtuple("Msg", ["role", "content"])
    Choice = namedtuple("Choice", ["index", "message", "finish_reason"])
    Result = namedtuple("Result", ["id", "object", "model", "choices", "usage"])
    return Result(
        id="chatcmpl-abc123",
        object="chat.completion",
        model="kimi-k2.6",
        choices=[
            Choice(
                index=0,
                message=Msg(role="assistant", content="Hello from Kimi."),
                finish_reason="stop",
            )
        ],
        usage=Usage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            prompt_tokens_details=Details(cached_tokens=cached),
        ),
    )


def _fake_moonshot_client(prompt_tokens=1200, completion_tokens=300, cached=400):
    """A client whose module is openai but whose base_url is Moonshot, i.e. Kimi.

    This mirrors how a developer actually uses Kimi: the OpenAI SDK pointed at
    Moonshot. detect_provider must resolve this to 'kimi', not 'openai'.
    """
    result = _kimi_response(prompt_tokens, completion_tokens, cached)

    class FakeMoonshot:
        pass

    FakeMoonshot.__module__ = "openai.client"  # module says openai...
    fake = FakeMoonshot()
    fake.base_url = "https://api.moonshot.ai/v1"  # ...base_url makes it Kimi
    fake.chat = MagicMock()
    fake.chat.completions = MagicMock()
    fake.chat.completions.create = MagicMock(return_value=result)
    return fake


def _stub_cap_checker(wk, result):
    wk._cap_checker.check = lambda **kwargs: result  # type: ignore[attr-defined]


def _capture_log(wk, captured):
    wk._logger.log = lambda payload: captured.__setitem__("payload", payload)  # type: ignore[attr-defined]


# ---------- response parsing ----------


def test_kimi_response_parsing_extracts_tokens_and_cache():
    it, ot, ci, cc = normalize_usage("kimi", _kimi_response())
    assert (it, ot, ci, cc) == (1200, 300, 400, 0)


# ---------- cost calculation (hand-calculated) ----------


def test_kimi_k2_6_cost_hand_calculated():
    # 800 uncached * 0.95/1M + 400 cached * 0.16/1M + 300 out * 4/1M
    # = 0.00076 + 0.000064 + 0.0012 = 0.002024
    assert calculate_cost("kimi-k2.6", 1200, 300, 400) == pytest.approx(0.002024, abs=1e-12)


def test_kimi_k3_k2_5_k2_cost():
    assert calculate_cost("kimi-k3", 1_000_000, 1_000_000) == pytest.approx(18.0, abs=1e-9)
    assert calculate_cost("kimi-k2.5", 1_000_000, 1_000_000) == pytest.approx(3.6, abs=1e-9)
    assert calculate_cost("kimi-k2", 1_000_000, 1_000_000) == pytest.approx(3.6, abs=1e-9)


def test_kimi_dated_variant_resolves_by_prefix():
    # kimi-k2.6-0930 must resolve to kimi-k2.6 (0.95), not the shorter kimi-k2 (0.60)
    assert resolve_pricing("kimi-k2.6-0930")["input"] == 0.95
    assert resolve_pricing("kimi-k3-1201")["input"] == 3.0


def test_kimi_pricing_rows_and_downgrades_present():
    for m in ("kimi-k3", "kimi-k2.6", "kimi-k2.5", "kimi-k2"):
        assert m in PRICING, m
    assert CHEAPER_ALTERNATIVE["kimi-k3"] == "kimi-k2.6"
    assert CHEAPER_ALTERNATIVE["kimi-k2.6"] == "kimi-k2.5"


# ---------- provider detection (several configs) ----------


def test_detect_kimi_moonshot_ai():
    class M:
        base_url = "https://api.moonshot.ai/v1"

    assert detect_provider(M()) == "kimi"


def test_detect_kimi_moonshot_cn():
    class M:
        base_url = "https://api.moonshot.cn/v1"

    assert detect_provider(M()) == "kimi"


def test_detect_openai_client_is_not_kimi():
    class O:
        base_url = "https://api.openai.com/v1"

    O.__module__ = "openai.client"
    assert detect_provider(O()) == "openai"


def test_detect_openai_no_base_url_is_not_kimi():
    class O:
        pass

    O.__module__ = "openai.resources.chat"
    o = O()
    o.chat = MagicMock()
    o.chat.completions = MagicMock()
    o.chat.completions.create = MagicMock()
    assert detect_provider(o) == "openai"


# ---------- end-to-end through wk.chat ----------


def test_kimi_chat_logs_provider_kimi_with_correct_tokens_and_cost():
    wk = Weckr(api_key="wk_test", plans={"pro": 29})
    _stub_cap_checker(wk, CapCheckResult(allowed=True))
    captured: dict = {}
    _capture_log(wk, captured)

    fake = _fake_moonshot_client(1200, 300, 400)
    expected = fake.chat.completions.create.return_value
    result = wk.chat(
        fake,
        {
            "model": "kimi-k2.6",
            "messages": [{"role": "user", "content": "hi"}],
            "user_id": "u1",
            "feature": "summary",
            "plan": "pro",
        },
    )
    assert result is expected  # response returned unmodified
    fake.chat.completions.create.assert_called_once()  # the real call happened
    p = captured["payload"]
    assert p["provider"] == "kimi"
    assert p["model"] == "kimi-k2.6"
    assert p["inputTokens"] == 1200
    assert p["outputTokens"] == 300
    assert p["cachedInputTokens"] == 400
    assert p["costUsd"] == pytest.approx(0.002024, abs=1e-12)


# ---------- fail-open when logging fails ----------


def test_kimi_fail_open_when_logging_raises():
    on_err = MagicMock()
    wk = Weckr(api_key="wk_test", plans={"pro": 29}, on_error=on_err)
    _stub_cap_checker(wk, CapCheckResult(allowed=True))

    def _boom(payload):
        raise RuntimeError("weckr log endpoint down")

    wk._logger.log = _boom  # type: ignore[attr-defined]

    fake = _fake_moonshot_client()
    expected = fake.chat.completions.create.return_value
    # Must NOT raise, and must return the Kimi result unchanged.
    result = wk.chat(
        fake,
        {"model": "kimi-k2.6", "messages": [], "user_id": "u1", "plan": "pro"},
    )
    assert result is expected
    fake.chat.completions.create.assert_called_once()
    on_err.assert_called()  # failure surfaced to on_error, never raised to the caller
