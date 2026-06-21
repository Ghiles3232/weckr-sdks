from __future__ import annotations

from typing import Optional


class WeckrCapError(Exception):
    """Raised by ``wk.chat(...)`` when the configured spending cap has been hit
    and the cap's action is ``"block"``. The LLM call is never made.

    Use :func:`is_weckr_cap_error` to check, since the class identity can vary
    if the SDK is imported through proxies.
    """

    name: str = "WeckrCapError"

    def __init__(
        self,
        message: Optional[str] = None,
        *,
        user_id: Optional[str] = None,
        plan_name: Optional[str] = None,
        current_spend: Optional[float] = None,
        cap: Optional[float] = None,
    ) -> None:
        msg = message or (
            f"Weckr: spending cap reached for user {user_id} on plan {plan_name}"
        )
        super().__init__(msg)
        self.user_id = user_id
        self.plan_name = plan_name
        self.current_spend = current_spend
        self.cap = cap


class WeckrConfigError(Exception):
    """Raised when the SDK detects an UNRECOVERABLE config error — a typo'd
    api key (401), revoked key (403), or a ``plan`` passed to ``chat()`` that
    isn't in the constructor's ``plans`` map.

    These fail-CLOSED on purpose: silent fail-open would silently disable cap
    enforcement (security control) or silently poison dashboard data with
    phantom unprofitable users.
    """

    name: str = "WeckrConfigError"

    def __init__(
        self,
        code: str,
        message: str,
    ) -> None:
        super().__init__(message)
        self.code = code  # "invalid_api_key" | "forbidden" | "unknown_plan"


def is_weckr_cap_error(e: object) -> bool:
    """True when ``e`` is a :class:`WeckrCapError` (by class or by ``name`` attr)."""
    if isinstance(e, WeckrCapError):
        return True
    return isinstance(e, BaseException) and getattr(e, "name", None) == "WeckrCapError"


def is_weckr_config_error(e: object) -> bool:
    """True when ``e`` is a :class:`WeckrConfigError` (by class or by ``name`` attr)."""
    if isinstance(e, WeckrConfigError):
        return True
    return isinstance(e, BaseException) and getattr(e, "name", None) == "WeckrConfigError"


__all__ = [
    "WeckrCapError",
    "WeckrConfigError",
    "is_weckr_cap_error",
    "is_weckr_config_error",
]
