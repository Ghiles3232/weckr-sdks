from __future__ import annotations

from collections import namedtuple

from weckr.normalize import detect_provider, normalize_usage


# ---------- normalize_usage ----------


def test_normalize_usage_openai():
    Usage = namedtuple("Usage", ["prompt_tokens", "completion_tokens"])
    Result = namedtuple("Result", ["usage"])
    result = Result(usage=Usage(prompt_tokens=12, completion_tokens=2))
    assert normalize_usage("openai", result) == (12, 2)


def test_normalize_usage_anthropic():
    Usage = namedtuple("Usage", ["input_tokens", "output_tokens"])
    Result = namedtuple("Result", ["usage"])
    result = Result(usage=Usage(input_tokens=5, output_tokens=10))
    assert normalize_usage("anthropic", result) == (5, 10)


def test_normalize_usage_gemini():
    Meta = namedtuple("Meta", ["prompt_token_count", "candidates_token_count"])
    Result = namedtuple("Result", ["usage_metadata"])
    result = Result(usage_metadata=Meta(prompt_token_count=3, candidates_token_count=7))
    assert normalize_usage("gemini", result) == (3, 7)


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
