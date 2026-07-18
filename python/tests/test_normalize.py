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
