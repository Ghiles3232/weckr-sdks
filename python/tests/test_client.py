from __future__ import annotations

from collections import namedtuple
from unittest.mock import MagicMock, patch

import pytest

from weckr import Weckr, WeckrCapError, WeckrConfigError, is_weckr_cap_error, is_weckr_config_error
from weckr.cap import CapCheckResult


# ---------- helpers ----------


def _fake_openai_client(prompt_tokens: int = 100, completion_tokens: int = 50):
    """Build a MagicMock that quacks like the openai SDK client.

    detect_provider checks the module name of the client's type — we set
    __module__ on a real class so the detection lands on 'openai'.
    """
    Usage = namedtuple("Usage", ["prompt_tokens", "completion_tokens"])
    Result = namedtuple("Result", ["usage", "choices"])
    result = Result(
        usage=Usage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens),
        choices=[],
    )

    class FakeOpenAI:
        pass

    FakeOpenAI.__module__ = "openai.client"
    fake = FakeOpenAI()
    fake.chat = MagicMock()
    fake.chat.completions = MagicMock()
    fake.chat.completions.create = MagicMock(return_value=result)
    return fake


def _stub_cap_checker(wk: Weckr, result: CapCheckResult) -> None:
    """Replace the Weckr instance's CapChecker with one that returns ``result``."""
    wk._cap_checker.check = lambda **kwargs: result  # type: ignore[attr-defined]


def _capture_log(wk: Weckr, captured: dict) -> None:
    """Replace the Weckr instance's Logger.log so we can assert payloads."""
    def _log(payload):
        captured["payload"] = payload
    wk._logger.log = _log  # type: ignore[attr-defined]


# ---------- tests ----------


def test_weckr_init_sets_plans():
    wk = Weckr(api_key="k", plans={"pro": 29})
    assert wk.plans == {"pro": 29}


def test_weckr_init_requires_api_key():
    with pytest.raises(ValueError):
        Weckr(api_key="", plans={"pro": 29})


def test_chat_returns_original_result_unchanged():
    wk = Weckr(api_key="k", plans={"pro": 29})
    _stub_cap_checker(wk, CapCheckResult(allowed=True))
    captured: dict = {}
    _capture_log(wk, captured)

    fake = _fake_openai_client(prompt_tokens=12, completion_tokens=2)
    expected = fake.chat.completions.create.return_value
    result = wk.chat(
        fake,
        {
            "model": "gpt-4o-mini",
            "messages": [],
            "user_id": "u1",
            "feature": "f",
            "plan": "pro",
        },
    )
    assert result is expected
    assert captured["payload"]["userId"] == "u1"


def test_chat_blocks_on_cap_exceeded():
    wk = Weckr(api_key="k", plans={"pro": 29})
    _stub_cap_checker(
        wk, CapCheckResult(allowed=False, action="block", current_spend=0, cap=5)
    )
    fake = _fake_openai_client()
    with pytest.raises(WeckrCapError) as exc_info:
        wk.chat(
            fake,
            {
                "model": "gpt-4o",
                "messages": [],
                "user_id": "u1",
                "plan": "pro",
            },
        )
    assert exc_info.value.cap == 5
    assert exc_info.value.user_id == "u1"
    assert is_weckr_cap_error(exc_info.value)
    fake.chat.completions.create.assert_not_called()


def test_chat_downgrades_model_on_action_downgrade():
    wk = Weckr(api_key="k", plans={"pro": 29})
    _stub_cap_checker(
        wk,
        CapCheckResult(
            allowed=False,
            action="downgrade",
            current_spend=10,
            cap=10,
            alternative_model="gpt-4o-mini",
        ),
    )
    _capture_log(wk, {})

    fake = _fake_openai_client()
    wk.chat(
        fake,
        {
            "model": "gpt-4o",
            "messages": [],
            "user_id": "u1",
            "plan": "pro",
        },
    )
    call_kwargs = fake.chat.completions.create.call_args.kwargs
    assert call_kwargs["model"] == "gpt-4o-mini"


def test_chat_downgrade_fallthrough_without_alternative_blocks():
    """REGRESSION: action='downgrade' but no alternative_model must NOT
    silently proceed with the original model. Old code fell through; new
    code raises WeckrCapError to fail closed."""
    wk = Weckr(api_key="k", plans={"pro": 29})
    _stub_cap_checker(
        wk,
        CapCheckResult(
            allowed=False,
            action="downgrade",
            current_spend=10,
            cap=10,
            alternative_model=None,  # server omitted the alternative
        ),
    )
    fake = _fake_openai_client()
    with pytest.raises(WeckrCapError):
        wk.chat(
            fake,
            {
                "model": "gpt-4o",
                "messages": [],
                "user_id": "u1",
                "plan": "pro",
            },
        )
    fake.chat.completions.create.assert_not_called()


def test_chat_raises_config_error_on_unknown_plan():
    """REGRESSION: plan not in the constructor's plans dict must fail-fast.
    Old code silently used $0 revenue and polluted dashboards."""
    wk = Weckr(api_key="k", plans={"pro": 29})
    fake = _fake_openai_client()
    with pytest.raises(WeckrConfigError) as exc_info:
        wk.chat(
            fake,
            {
                "model": "gpt-4o-mini",
                "messages": [],
                "user_id": "u1",
                "plan": "tipo_premium",  # not in plans dict
            },
        )
    assert is_weckr_config_error(exc_info.value)
    assert exc_info.value.code == "unknown_plan"
    fake.chat.completions.create.assert_not_called()


def test_chat_logs_payload_with_camel_case_and_full_precision_margin():
    wk = Weckr(api_key="k", plans={"pro": 29})
    _stub_cap_checker(wk, CapCheckResult(allowed=True))
    captured: dict = {}
    _capture_log(wk, captured)

    fake = _fake_openai_client(prompt_tokens=12, completion_tokens=2)
    wk.chat(
        fake,
        {
            "model": "gpt-4o-mini",
            "messages": [],
            "user_id": "u1",
            "feature": "ai-summary",
            "plan": "pro",
        },
    )
    payload = captured["payload"]
    for k in (
        "userId", "feature", "model", "provider",
        "inputTokens", "outputTokens", "costUsd", "latencyMs",
        "planName", "planRevenueUsd", "marginUsd",
    ):
        assert k in payload, f"missing key {k}"
    # 12 input + 2 output on gpt-4o-mini = 3e-6
    assert payload["costUsd"] == pytest.approx(0.000003, abs=1e-9)
    assert payload["planRevenueUsd"] == 29
    # Full precision (no 2dp rounding)
    assert payload["marginUsd"] == pytest.approx(29 - 0.000003, abs=1e-12)


def test_chat_no_userid_no_plan_skips_cap_check_still_logs():
    """REGRESSION: omitting user_id/plan must NOT 400-out logs."""
    wk = Weckr(api_key="k", plans={})
    check_called = {"count": 0}

    def _spy_check(**kwargs):
        check_called["count"] += 1
        return CapCheckResult(allowed=True)

    wk._cap_checker.check = _spy_check  # type: ignore[attr-defined]
    captured: dict = {}
    _capture_log(wk, captured)

    fake = _fake_openai_client(prompt_tokens=5, completion_tokens=3)
    wk.chat(
        fake,
        {
            "model": "gpt-4o-mini",
            "messages": [],
            # no user_id, no plan, no feature
        },
    )
    # cap check skipped entirely (user_id empty)
    assert check_called["count"] == 1  # method called, but inside it short-circuits
    # log still fired
    assert captured["payload"]["userId"] is None
    assert captured["payload"]["planName"] is None
    assert captured["payload"]["planRevenueUsd"] is None
    assert captured["payload"]["marginUsd"] is None


def test_cap_cache_skips_second_http_call_within_60s_legacy():
    """Spec test #7 (legacy module-level cap.check_cap): cache works."""
    fake_response = MagicMock()
    fake_response.read.return_value = b'{"allowed": true, "currentSpend": 0, "cap": 100}'
    fake_response.__enter__ = MagicMock(return_value=fake_response)
    fake_response.__exit__ = MagicMock(return_value=False)

    from weckr import cap as cap_module
    cap_module._CACHE.clear()

    with patch("weckr.cap.urllib.request.urlopen", return_value=fake_response) as mock_urlopen:
        cap_module.check_cap(
            check_endpoint=cap_module.DEFAULT_CHECK_ENDPOINT,
            api_key="k",
            user_id="u1",
            plan_name="pro",
            model="gpt-4o",
        )
        cap_module.check_cap(
            check_endpoint=cap_module.DEFAULT_CHECK_ENDPOINT,
            api_key="k",
            user_id="u1",
            plan_name="pro",
            model="gpt-4o",
        )
        assert mock_urlopen.call_count == 1


def test_cap_check_uses_get_not_post():
    """REGRESSION: the live /api/v1/check is GET. Verify we send GET."""
    fake_response = MagicMock()
    fake_response.read.return_value = b'{"allowed": true}'
    fake_response.__enter__ = MagicMock(return_value=fake_response)
    fake_response.__exit__ = MagicMock(return_value=False)

    from weckr import cap as cap_module
    cap_module._CACHE.clear()

    with patch("weckr.cap.urllib.request.urlopen", return_value=fake_response) as mock_urlopen:
        cap_module.check_cap(
            check_endpoint=cap_module.DEFAULT_CHECK_ENDPOINT,
            api_key="k",
            user_id="u_get",
            plan_name="pro",
            model="gpt-4o",
        )
        sent_request = mock_urlopen.call_args.args[0]
        assert sent_request.get_method() == "GET"
        assert sent_request.data is None
        assert "userId=u_get" in sent_request.full_url
        assert "planName=pro" in sent_request.full_url


def test_cap_check_401_raises_config_error():
    """REGRESSION: 401 from /check must fail-CLOSED. Old code silently allowed."""
    import urllib.error
    from weckr.cap import CapChecker

    err = urllib.error.HTTPError(
        url="x", code=401, msg="Unauthorized", hdrs=None, fp=None,  # type: ignore[arg-type]
    )

    checker = CapChecker(check_endpoint="https://x/api/v1/check", api_key="wk_bad")
    with patch("weckr.cap.urllib.request.urlopen", side_effect=err):
        with pytest.raises(WeckrConfigError) as exc_info:
            checker.check(user_id="u1", plan_name="pro", model="gpt-4o")
    assert exc_info.value.code == "invalid_api_key"


def test_cap_check_5xx_fails_open():
    """5xx should still fail-open (don't take down customer apps for our outages)."""
    import urllib.error
    from weckr.cap import CapChecker

    err = urllib.error.HTTPError(
        url="x", code=503, msg="bad gateway", hdrs=None, fp=None,  # type: ignore[arg-type]
    )
    err.read = lambda: b""  # type: ignore[assignment]

    on_err = MagicMock()
    checker = CapChecker(
        check_endpoint="https://x/api/v1/check", api_key="wk_ok", on_error=on_err
    )
    with patch("weckr.cap.urllib.request.urlopen", side_effect=err):
        result = checker.check(user_id="u1", plan_name="pro", model="gpt-4o")
    assert result.allowed is True
    on_err.assert_called_once()


def test_cap_check_cache_key_includes_model():
    """REGRESSION: cache key omitting model bled gpt-4o-mini downgrade onto Anthropic calls.

    Two calls with same (user, plan) but different models must NOT share a cache entry.
    """
    from weckr.cap import CapChecker

    fake_response_openai = MagicMock()
    fake_response_openai.read.return_value = (
        b'{"allowed": false, "action": "downgrade", "alternativeModel": "gpt-4o-mini"}'
    )
    fake_response_openai.__enter__ = MagicMock(return_value=fake_response_openai)
    fake_response_openai.__exit__ = MagicMock(return_value=False)

    fake_response_anthropic = MagicMock()
    fake_response_anthropic.read.return_value = b'{"allowed": true}'
    fake_response_anthropic.__enter__ = MagicMock(return_value=fake_response_anthropic)
    fake_response_anthropic.__exit__ = MagicMock(return_value=False)

    responses = [fake_response_openai, fake_response_anthropic]

    checker = CapChecker(check_endpoint="https://x/api/v1/check", api_key="wk_ok")
    with patch("weckr.cap.urllib.request.urlopen", side_effect=responses) as mock_urlopen:
        r1 = checker.check(user_id="u1", plan_name="pro", model="gpt-4o")
        r2 = checker.check(user_id="u1", plan_name="pro", model="claude-sonnet-4")
    assert mock_urlopen.call_count == 2  # two distinct cache keys → two requests
    assert r1.alternative_model == "gpt-4o-mini"
    assert r2.allowed is True
