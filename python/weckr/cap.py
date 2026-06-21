from __future__ import annotations

"""Spend-cap check against /api/v1/check.

Public class: :class:`CapChecker`. The cache is INSTANCE-scoped (one per
Weckr) so multi-tenant gateways don't leak decisions across api keys.

Cache key includes (api_key, user_id, plan_name, model) — JSON-encoded to
avoid string-concat collisions like ('a','b c') vs ('a b','c').

Fail behavior:
  - 5xx, 429, network error, JSON parse error  → fail OPEN (allowed=True)
  - 401, 403                                   → fail CLOSED (raise WeckrConfigError)

The 401/403 fail-closed is deliberate. The old behavior conflated bad-key
errors with transient outages, which silently disabled every cap config for
a customer that shipped a typo'd wk_ key.
"""

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Tuple

from .errors import WeckrConfigError

DEFAULT_CHECK_ENDPOINT = "https://app.useweckr.com/api/v1/check"
_CACHE_TTL_SECONDS = 60.0
_CHECK_TIMEOUT_SECONDS = 3.0


@dataclass
class CapCheckResult:
    """Decoded response from /api/v1/check."""

    allowed: bool = True
    action: Optional[str] = None
    alternative_model: Optional[str] = None
    remaining_budget: Optional[float] = None
    current_spend: Optional[float] = None
    cap: Optional[float] = None


# Module-level cache kept for backward-compat with users who imported it.
# New code should use CapChecker. The legacy function below maintains it.
_CACHE: Dict[Tuple[str, str], Tuple[CapCheckResult, float]] = {}


class CapChecker:
    """Per-Weckr cap checker with instance-scoped cache and in-flight dedup."""

    def __init__(
        self,
        *,
        check_endpoint: str,
        api_key: str,
        on_error: Optional[Callable[[BaseException], None]] = None,
    ) -> None:
        self.check_endpoint = check_endpoint
        self.api_key = api_key
        self.on_error = on_error
        self._cache: Dict[str, Tuple[CapCheckResult, float]] = {}
        # Per-key in-flight Locks so N parallel chat() calls share one /check
        # request rather than racing all of them through.
        self._locks: Dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _key(self, user_id: str, plan_name: str, model: Optional[str]) -> str:
        return json.dumps([user_id, plan_name, model or None])

    def _get_lock(self, key: str) -> threading.Lock:
        with self._locks_guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._locks[key] = lock
            return lock

    def check(
        self,
        user_id: str,
        plan_name: str,
        model: Optional[str] = None,
        disable_cap_check: bool = False,
    ) -> CapCheckResult:
        if disable_cap_check or not user_id or not plan_name:
            return CapCheckResult(allowed=True)

        k = self._key(user_id, plan_name, model)
        now = time.time()
        cached = self._cache.get(k)
        if cached is not None and now < cached[1]:
            return cached[0]

        # Lock per key so the second concurrent caller waits and reuses the
        # cached result instead of firing a duplicate /check.
        lock = self._get_lock(k)
        with lock:
            now = time.time()
            cached = self._cache.get(k)
            if cached is not None and now < cached[1]:
                return cached[0]
            result = self._fetch(user_id, plan_name, model)
            self._cache[k] = (result, time.time() + _CACHE_TTL_SECONDS)
            return result

    def _fetch(
        self, user_id: str, plan_name: str, model: Optional[str]
    ) -> CapCheckResult:
        query: Dict[str, str] = {"userId": user_id, "planName": plan_name}
        if model:
            query["model"] = model
        url = f"{self.check_endpoint}?{urllib.parse.urlencode(query)}"

        req = urllib.request.Request(
            url, method="GET", headers={"x-api-key": self.api_key}
        )

        try:
            with urllib.request.urlopen(req, timeout=_CHECK_TIMEOUT_SECONDS) as resp:
                body = resp.read()
                data = json.loads(body.decode("utf-8"))
                return CapCheckResult(
                    allowed=bool(data.get("allowed", True)),
                    action=data.get("action"),
                    alternative_model=data.get("alternativeModel"),
                    remaining_budget=data.get("remainingBudget"),
                    current_spend=data.get("currentSpend"),
                    cap=data.get("cap"),
                )
        except urllib.error.HTTPError as e:
            # Fail CLOSED on 401/403 — typo'd / revoked key. Don't let cap
            # enforcement be silently disabled.
            if e.code in (401, 403):
                body = ""
                try:
                    body = e.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
                raise WeckrConfigError(
                    "invalid_api_key" if e.code == 401 else "forbidden",
                    f"Weckr: cap-check rejected with {e.code}. Verify the api key "
                    f"at https://app.useweckr.com/dashboard/settings. "
                    f"Server said: {body or '(no body)'}",
                )
            # 5xx / 429 / other 4xx: fail open, surface to on_error.
            if self.on_error is not None:
                try:
                    self.on_error(e)
                except Exception:
                    pass
            return CapCheckResult(allowed=True)
        except Exception as err:
            # Network error, JSON parse error, timeout — fail open.
            if self.on_error is not None:
                try:
                    self.on_error(err)
                except Exception:
                    pass
            return CapCheckResult(allowed=True)


# Backward-compat shim — old code may import and call check_cap() directly.
# New code uses CapChecker. We keep _CACHE in module scope here so the
# regression test (test_cap_cache_skips_second_http_call_within_60s) keeps
# passing without modification.
def check_cap(
    check_endpoint: str,
    api_key: str,
    user_id: str,
    plan_name: str,
    model: Optional[str] = None,
    disable_cap_check: bool = False,
    on_error: Optional[Callable[[BaseException], None]] = None,
) -> CapCheckResult:
    """Backward-compat function wrapping a module-shared CapChecker.

    Prefer ``CapChecker(...).check(...)`` in new code — this function keeps
    the module-level ``_CACHE`` for legacy tests but loses instance isolation.
    """
    if disable_cap_check or not user_id or not plan_name:
        return CapCheckResult(allowed=True)

    key = (user_id, plan_name)
    now = time.time()
    cached = _CACHE.get(key)
    if cached is not None and now < cached[1]:
        return cached[0]

    checker = CapChecker(
        check_endpoint=check_endpoint, api_key=api_key, on_error=on_error
    )
    result = checker._fetch(user_id, plan_name, model)
    _CACHE[key] = (result, time.time() + _CACHE_TTL_SECONDS)
    return result


__all__ = [
    "CapChecker",
    "CapCheckResult",
    "check_cap",
    "DEFAULT_CHECK_ENDPOINT",
    "_CACHE",
]
