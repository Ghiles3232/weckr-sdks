from __future__ import annotations

from collections import namedtuple

from weckr.normalize import detect_provider, normalize_usage


# ---------- normalize_usage ----------


def test_normalize_usage_openai():
    Usage = namedtuple("Usage", ["prompt_tokens", "completion_tokens"])
    Result = namedtuple("Result", ["usage"])
    result = Result(usage=Usage(prompt_tokens=12, completion_tokens=2))
    # No cache fields present -> cached + creation default to 0.
    assert normalize_usage("openai", result) == (12, 2, 0, 0)


def test_normalize_usage_anthropic():
    Usage = namedtuple("Usage", ["input_tokens", "output_tokens"])
    Result = namedtuple("Result", ["usage"])
    result = Result(usage=Usage(input_tokens=5, output_tokens=10))
    assert normalize_usage("anthropic", result) == (5, 10, 0, 0)


def test_normalize_usage_gemini():
    Meta = namedtuple("Meta", ["prompt_token_count", "candidates_token_count"])
    Result = namedtuple("Result", ["usage_metadata"])
    result = Result(usage_metadata=Meta(prompt_token_count=3, candidates_token_count=7))
    assert normalize_usage("gemini", result) == (3, 7, 0, 0)


# ---------- normalize_usage: prompt caching ----------


def test_normalize_usage_openai_cached():
    # prompt_tokens is the TOTAL (cached included); cached_tokens is the subset.
    Details = namedtuple("Details", ["cached_tokens"])
    Usage = namedtuple(
        "Usage", ["prompt_tokens", "completion_tokens", "prompt_tokens_details"]
    )
    Result = namedtuple("Result", ["usage"])
    result = Result(
        usage=Usage(
            prompt_tokens=1000,
            completion_tokens=200,
            prompt_tokens_details=Details(cached_tokens=600),
        )
    )
    assert normalize_usage("openai", result) == (1000, 200, 600, 0)


def test_normalize_usage_anthropic_cache_read_and_write():
    # input_tokens is UNCACHED only; cache reads fold into input, writes are additive.
    Usage = namedtuple(
        "Usage",
        [
            "input_tokens",
            "output_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
        ],
    )
    Result = namedtuple("Result", ["usage"])
    result = Result(
        usage=Usage(
            input_tokens=400,
            output_tokens=200,
            cache_read_input_tokens=600,
            cache_creation_input_tokens=300,
        )
    )
    # 400 uncached + 600 cache-read = 1000 input; 600 cached; 300 creation.
    assert normalize_usage("anthropic", result) == (1000, 200, 600, 300)


def test_normalize_usage_gemini_cached():
    Meta = namedtuple(
        "Meta",
        ["prompt_token_count", "candidates_token_count", "cached_content_token_count"],
    )
    Result = namedtuple("Result", ["usage_metadata"])
    result = Result(
        usage_metadata=Meta(
            prompt_token_count=2000,
            candidates_token_count=300,
            cached_content_token_count=1500,
        )
    )
    assert normalize_usage("gemini", result) == (2000, 300, 1500, 0)


# ---------- detect_provider ----------


class _OpenAIShaped:
    pass


_OpenAIShaped.__module__ = "openai.client"


class _UnknownShaped:
    pass


_UnknownShaped.__module__ = "unknown.module"


def test_detect_provider_openai():
    assert detect_provider(_OpenAIShaped()) == "openai"


def test_detect_provider_unknown():
    assert detect_provider(_UnknownShaped()) == "unknown"


# ---------- Kimi (Moonshot AI) ----------


class _MoonshotAiClient:
    base_url = "https://api.moonshot.ai/v1"


class _MoonshotCnClient:
    base_url = "https://api.moonshot.cn/v1"


# A real OpenAI client points at api.openai.com and must NOT be read as Kimi.
class _OpenAiClientWithBaseUrl:
    base_url = "https://api.openai.com/v1"


_OpenAiClientWithBaseUrl.__module__ = "openai.client"


def test_detect_provider_kimi_moonshot_ai():
    assert detect_provider(_MoonshotAiClient()) == "kimi"


def test_detect_provider_kimi_moonshot_cn():
    assert detect_provider(_MoonshotCnClient()) == "kimi"


def test_detect_provider_openai_not_kimi():
    # base_url is api.openai.com, so the moonshot check must not fire.
    assert detect_provider(_OpenAiClientWithBaseUrl()) == "openai"


def test_normalize_usage_kimi():
    # Kimi (Moonshot) is OpenAI compatible; usage has the OpenAI shape.
    Details = namedtuple("Details", ["cached_tokens"])
    Usage = namedtuple(
        "Usage", ["prompt_tokens", "completion_tokens", "prompt_tokens_details"]
    )
    Result = namedtuple("Result", ["usage"])
    result = Result(
        usage=Usage(
            prompt_tokens=100,
            completion_tokens=50,
            prompt_tokens_details=Details(cached_tokens=20),
        )
    )
    assert normalize_usage("kimi", result) == (100, 50, 20, 0)
