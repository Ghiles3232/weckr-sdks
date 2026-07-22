from __future__ import annotations

"""Provider detection and usage normalization.

``detect_provider(client)`` returns one of: "openai", "anthropic", "gemini",
"kimi", "unknown". We try module-name first, then fall back to shape-based detection
so wrapped/proxied clients (Sentry, OpenTelemetry, custom retry wrappers)
aren't rejected just because their __module__ doesn't match.

``normalize_usage(provider, result)`` returns ``(input_tokens, output_tokens)``.
Missing / malformed fields collapse to 0.
"""

import math
from typing import Any, Tuple


def _to_int(v: Any) -> int:
    try:
        if v is None:
            return 0
        n = float(v)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(n):
        return 0
    return max(0, int(n))


def _get(obj: Any, key: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _has_method(obj: Any, path: str) -> bool:
    """Return True if obj.<path> is callable. `path` may be dotted."""
    current = obj
    for part in path.split("."):
        if current is None:
            return False
        current = getattr(current, part, None)
        if current is None:
            return False
    return callable(current)


def _is_moonshot_client(client: Any) -> bool:
    """True if ``client`` is an OpenAI-shaped client pointed at Moonshot's API.

    The OpenAI Python client exposes ``client.base_url``; a Moonshot endpoint
    (api.moonshot.ai or api.moonshot.cn) means the caller is using Kimi even
    though the client class is OpenAI's.
    """
    base = _get(client, "base_url")
    if base is None:
        return False
    text = str(base).lower()
    return "moonshot.ai" in text or "moonshot.cn" in text


def detect_provider(client: Any) -> str:
    """Module-name first, shape-based fallback."""
    if client is None:
        return "unknown"

    # Kimi (Moonshot AI) uses the OpenAI-compatible client pointed at Moonshot's
    # endpoint, so it looks exactly like OpenAI by module name and by shape. Tell
    # them apart by the base URL targeting Moonshot; check this first.
    if _is_moonshot_client(client):
        return "kimi"

    module_name = ""
    try:
        module_name = (type(client).__module__ or "").lower()
    except Exception:
        module_name = ""

    if "openai" in module_name:
        return "openai"
    if "anthropic" in module_name or "claude" in module_name:
        return "anthropic"
    if (
        "google.genai" in module_name
        or "google.generativeai" in module_name
        or "genai" in module_name
        or "gemini" in module_name
    ):
        return "gemini"

    # Shape-based fallback for wrapped/proxied clients whose __module__ is
    # something other than the SDK's (e.g. wrapt.ObjectProxy from
    # opentelemetry-instrumentation-openai).
    if _has_method(client, "chat.completions.create"):
        return "openai"
    if _has_method(client, "messages.create"):
        return "anthropic"
    if _has_method(client, "models.generate_content") or _has_method(
        client, "models.generateContent"
    ):
        return "gemini"
    # Legacy google.generativeai shape.
    if _has_method(client, "GenerativeModel"):
        return "gemini"

    return "unknown"


def is_streaming_response(result: Any) -> bool:
    """Best-effort check: is `result` an async iterator / streaming object?

    We can't get token usage out of streams without a wrapper, so we want to
    refuse them at chat-time rather than silently log 0 tokens.
    """
    if result is None:
        return False
    # OpenAI / Anthropic streams expose __aiter__ or __iter__ on the response.
    if hasattr(result, "__aiter__") and not hasattr(result, "choices"):
        return True
    # ChatCompletionStreamManager / MessageStreamManager
    if type(result).__name__.endswith("StreamManager"):
        return True
    return False


def normalize_usage(provider: str, result: Any) -> Tuple[int, int, int, int]:
    """Return ``(input_tokens, output_tokens, cached_input_tokens, cache_creation_tokens)``.

    ``cached_input_tokens`` is the cache-READ subset already included in
    ``input_tokens`` (billed at the reduced cache rate). ``cache_creation_tokens``
    is additive cache-WRITE volume (Anthropic prompt caching); 0 for other providers.
    """
    if provider in ("openai", "kimi"):
        # Moonshot (Kimi) is OpenAI compatible, so its usage object matches OpenAI's.
        usage = _get(result, "usage")
        prompt = _get(usage, "prompt_tokens")
        if prompt is None:
            prompt = _get(usage, "input_tokens")
        completion = _get(usage, "completion_tokens")
        if completion is None:
            completion = _get(usage, "output_tokens")
        input_tokens = _to_int(prompt)
        # prompt_tokens is the TOTAL input; cached_tokens is the cache-read subset.
        details = _get(usage, "prompt_tokens_details")
        cached = min(_to_int(_get(details, "cached_tokens")), input_tokens)
        return input_tokens, _to_int(completion), cached, 0

    if provider == "anthropic":
        usage = _get(result, "usage")
        raw_input = _to_int(_get(usage, "input_tokens"))
        cache_read = _to_int(_get(usage, "cache_read_input_tokens"))
        cache_creation = _to_int(_get(usage, "cache_creation_input_tokens"))
        # input_tokens is UNCACHED only; fold cache reads in so the server's
        # (cached <= input, uncached = input - cached) invariant holds.
        return raw_input + cache_read, _to_int(_get(usage, "output_tokens")), cache_read, cache_creation

    if provider == "gemini":
        meta = _get(result, "usage_metadata")
        if meta is None:
            meta = _get(result, "usageMetadata")
        prompt = _get(meta, "prompt_token_count")
        if prompt is None:
            prompt = _get(meta, "promptTokenCount")
        completion = _get(meta, "candidates_token_count")
        if completion is None:
            completion = _get(meta, "candidatesTokenCount")
        input_tokens = _to_int(prompt)
        # promptTokenCount is the TOTAL input; cachedContentTokenCount is the subset.
        cached_raw = _get(meta, "cached_content_token_count")
        if cached_raw is None:
            cached_raw = _get(meta, "cachedContentTokenCount")
        cached = min(_to_int(cached_raw), input_tokens)
        # Gemini 2.5+/3.x are thinking models. Google bills hidden reasoning as
        # output, but candidatesTokenCount is only the visible answer, so add
        # thoughtsTokenCount (0 on non-thinking models) to get the billed output.
        thoughts = _get(meta, "thoughts_token_count")
        if thoughts is None:
            thoughts = _get(meta, "thoughtsTokenCount")
        return input_tokens, _to_int(completion) + _to_int(thoughts), cached, 0

    return 0, 0, 0, 0


__all__ = ["detect_provider", "normalize_usage", "is_streaming_response"]
