from __future__ import annotations

"""Provider detection and usage normalization.

``detect_provider(client)`` returns one of: "openai", "anthropic", "gemini",
"unknown". We try module-name first, then fall back to shape-based detection
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


def detect_provider(client: Any) -> str:
    """Module-name first, shape-based fallback."""
    if client is None:
        return "unknown"

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


def normalize_usage(provider: str, result: Any) -> Tuple[int, int]:
    """Return ``(input_tokens, output_tokens)`` from a provider response."""
    if provider == "openai":
        usage = _get(result, "usage")
        prompt = _get(usage, "prompt_tokens")
        if prompt is None:
            prompt = _get(usage, "input_tokens")
        completion = _get(usage, "completion_tokens")
        if completion is None:
            completion = _get(usage, "output_tokens")
        return _to_int(prompt), _to_int(completion)

    if provider == "anthropic":
        usage = _get(result, "usage")
        return _to_int(_get(usage, "input_tokens")), _to_int(_get(usage, "output_tokens"))

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
        return _to_int(prompt), _to_int(completion)

    return 0, 0


__all__ = ["detect_provider", "normalize_usage", "is_streaming_response"]
