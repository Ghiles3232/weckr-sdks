from __future__ import annotations

"""Main Weckr class. Mirrors the @weckr/sdk public interface for TypeScript:

    wk = Weckr(api_key="wk_...", plans={"free": 0, "pro": 29})
    result = wk.chat(openai_client, {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Summarize this."}],
        "user_id": user.id,
        "feature": "ai-summary",
        "plan": user.plan,
    })

user_id, feature, plan, and model live INSIDE the params dict — same shape
as the TS SDK.
"""

import time
import uuid
import warnings
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from .cap import CapChecker
from .errors import WeckrCapError, WeckrConfigError
from .logger import Logger
from .normalize import detect_provider, is_streaming_response, normalize_usage
from .pricing import CHEAPER_ALTERNATIVE, calculate_cost

DEFAULT_LOG_ENDPOINT = "https://app.useweckr.com/api/v1/log"
DEFAULT_CHECK_ENDPOINT = "https://app.useweckr.com/api/v1/check"


class WeckrDowngradeWarning(UserWarning):
    """Warning class for cap-downgrade notifications.

    Subclass of UserWarning so apps that use ``filterwarnings('error', UserWarning)``
    don't escalate the downgrade into an exception inside wk.chat(). To suppress:

        warnings.filterwarnings('ignore', category=WeckrDowngradeWarning)
    """


class Weckr:
    def __init__(
        self,
        api_key: str,
        plans: Optional[Dict[str, float]] = None,
        endpoint: str = DEFAULT_LOG_ENDPOINT,
        check_endpoint: str = DEFAULT_CHECK_ENDPOINT,
        disable_cap_check: bool = False,
        on_error: Optional[Callable[[BaseException], None]] = None,
        on_downgrade: Optional[Callable[[Dict[str, str]], None]] = None,
    ) -> None:
        if not api_key:
            raise ValueError("Weckr: api_key is required.")
        self.api_key = api_key
        self.plans: Dict[str, float] = plans or {}
        self.endpoint = endpoint
        self.check_endpoint = check_endpoint
        self.disable_cap_check = disable_cap_check
        self.on_error = on_error
        self.on_downgrade = on_downgrade
        self._downgrade_seen: set = set()

        # Instance-scoped checker (no module-shared state).
        self._cap_checker = CapChecker(
            check_endpoint=check_endpoint,
            api_key=api_key,
            on_error=on_error,
        )
        self._logger = Logger(
            endpoint=endpoint,
            api_key=api_key,
            on_error=on_error,
        )

    def chat(self, client: Any, params: Dict[str, Any]) -> Any:
        """Wrap any LLM client call. Returns the original result unchanged."""
        # Shallow-copy so we never mutate the caller's dict.
        params = dict(params)

        user_id = params.pop("user_id", None)
        feature = params.pop("feature", None)
        plan_name = params.pop("plan", None)
        model = params.get("model", "unknown")

        # Fail-fast on misconfigured plan name. Silent fallback to $0 revenue
        # would poison the dashboard with phantom unprofitable users.
        if plan_name is not None and plan_name not in self.plans:
            raise WeckrConfigError(
                "unknown_plan",
                f'Weckr: plan "{plan_name}" is not in the constructor\'s `plans` map. '
                f'Add it as plans={{"{plan_name}": <monthly_usd>}} when constructing Weckr.',
            )

        plan_revenue = (
            float(self.plans[plan_name]) if plan_name is not None else None
        )

        # 1) Cap check (may raise WeckrConfigError on 401/403; fail-open on 5xx).
        check = self._cap_checker.check(
            user_id=user_id or "",
            plan_name=plan_name or "",
            model=model,
            disable_cap_check=self.disable_cap_check,
        )
        if not check.allowed:
            if check.action == "downgrade" and check.alternative_model:
                self._emit_downgrade(user_id or "", model, check.alternative_model)
                params["model"] = check.alternative_model
                model = check.alternative_model
            else:
                # action='block', or action='downgrade' with no alternative,
                # or unexpected shape — fail CLOSED to match the TS SDK.
                raise WeckrCapError(
                    f"Weckr: spending cap reached for user {user_id} on plan {plan_name}",
                    user_id=user_id or "",
                    plan_name=plan_name or "",
                    current_spend=check.current_spend,
                    cap=check.cap,
                )

        # 2) Detect provider + call (capture errors so we can log them).
        # Generate the event_id ONCE here so it's stable across the LLM call,
        # any retries, and the (potentially errored) log emission below. The
        # server dedupes on (project_id, event_id) — same call retried = same
        # dashboard row, not a duplicate.
        event_id = str(uuid.uuid4())
        self._last_event_id = event_id

        provider = detect_provider(client)
        start = time.time()
        try:
            result = self._call_provider(client, provider, params)
        except Exception:
            latency_ms = int((time.time() - start) * 1000)
            # Log an error row so the dashboard sees the failure.
            self._try_log(
                user_id=user_id,
                feature=feature,
                model=model,
                provider=provider,
                input_tokens=0,
                output_tokens=0,
                latency_ms=latency_ms,
                plan_name=plan_name,
                plan_revenue=plan_revenue,
                event_id=event_id,
            )
            raise
        latency_ms = int((time.time() - start) * 1000)

        # Streaming check — usage isn't in stream responses by default.
        if is_streaming_response(result):
            if self.on_error is not None:
                try:
                    self.on_error(
                        Exception(
                            "Weckr: streaming response detected — token usage "
                            "will not be captured. Disable streaming or pass "
                            "stream_options={'include_usage': True} (when "
                            "support is added)."
                        )
                    )
                except Exception:
                    pass

        # 3) Best-effort log.
        try:
            input_tokens, output_tokens = normalize_usage(provider, result)
        except Exception as err:
            input_tokens, output_tokens = 0, 0
            if self.on_error is not None:
                try:
                    self.on_error(err)
                except Exception:
                    pass
        self._try_log(
            user_id=user_id,
            feature=feature,
            model=model,
            provider=provider,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            plan_name=plan_name,
            plan_revenue=plan_revenue,
            event_id=event_id,
        )

        return result

    @property
    def last_event_id(self) -> Optional[str]:
        """The event_id of the most recent chat() call.

        Useful when the caller wants to correlate this specific LLM call to a
        dashboard row in customer support flows ("which call was that?").
        """
        return getattr(self, "_last_event_id", None)

    def _emit_downgrade(self, user_id: str, from_model: str, to_model: str) -> None:
        info = {"userId": user_id, "from": from_model, "to": to_model}
        if self.on_downgrade is not None:
            try:
                self.on_downgrade(info)
                return
            except Exception:
                pass
        key = f"{user_id}:{from_model}>{to_model}"
        if key in self._downgrade_seen:
            return
        self._downgrade_seen.add(key)
        warnings.warn(
            f"Weckr: downgrading {user_id} from {from_model} to {to_model} (cap reached). "
            "Subsequent downgrades for this user/model will be silent.",
            category=WeckrDowngradeWarning,
            stacklevel=3,
        )

    def _try_log(
        self,
        *,
        user_id: Optional[str],
        feature: Optional[str],
        model: str,
        provider: str,
        input_tokens: int,
        output_tokens: int,
        latency_ms: int,
        plan_name: Optional[str],
        plan_revenue: Optional[float],
        event_id: str,
    ) -> None:
        try:
            cost_usd = calculate_cost(model, input_tokens, output_tokens)
            margin_usd = (
                plan_revenue - cost_usd if plan_revenue is not None else None
            )
            payload: Dict[str, Any] = {
                "userId": user_id,
                "feature": feature,
                "model": model,
                "provider": provider,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "costUsd": cost_usd,
                "latencyMs": latency_ms,
                "eventId": event_id,
                "planName": plan_name,
                "planRevenueUsd": plan_revenue,
                # marginUsd is sent for backward-compat; server ignores it.
                "marginUsd": margin_usd,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self._logger.log(payload)
        except Exception as err:
            if self.on_error is not None:
                try:
                    self.on_error(err)
                except Exception:
                    pass

    def _call_provider(self, client: Any, provider: str, params: Dict[str, Any]) -> Any:
        if provider == "openai":
            return client.chat.completions.create(**params)
        if provider == "anthropic":
            return client.messages.create(**params)
        if provider == "gemini":
            return self._call_gemini(client, params)
        if provider == "unknown":
            # Unknown providers: try a generic .chat.completions.create as a
            # last-ditch, otherwise raise a clear error.
            chat = getattr(client, "chat", None)
            completions = getattr(chat, "completions", None) if chat else None
            create = getattr(completions, "create", None) if completions else None
            if callable(create):
                return create(**params)
            raise ValueError(
                "Weckr: could not detect provider for this client. Pass an "
                "OpenAI, Anthropic, or Gemini client instance."
            )
        raise ValueError(f"Unsupported provider: {provider}")

    def _call_gemini(self, client: Any, params: Dict[str, Any]) -> Any:
        """Gemini's two SDK generations have very different shapes.

        New SDK (google-genai >= 0.4): ``client.models.generate_content(model=..., contents=...)``.
        Legacy SDK (google-generativeai): ``client.GenerativeModel(model).generate_content(...)``.

        Both want a ``contents`` list with proper role+parts, not a flat
        space-joined string (which lost system_instruction and dropped role
        distinctions in the previous implementation).
        """
        model_name = params.get("model", "gemini-2.5-flash")
        messages = params.get("messages", []) or []
        other = {
            k: v for k, v in params.items() if k not in ("model", "messages")
        }

        # Build a Gemini-shaped contents array. Role mapping: assistant→model;
        # system messages become system_instruction.
        contents = []
        system_instruction = None
        for m in messages:
            if not isinstance(m, dict):
                continue
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "system":
                system_instruction = content
                continue
            mapped_role = "model" if role == "assistant" else "user"
            contents.append(
                {
                    "role": mapped_role,
                    "parts": [{"text": content if isinstance(content, str) else str(content)}],
                }
            )

        # Try new SDK first.
        models = getattr(client, "models", None)
        if models is not None and callable(getattr(models, "generate_content", None)):
            kwargs = {"model": model_name, "contents": contents, **other}
            if system_instruction is not None:
                kwargs.setdefault("config", {})
                if isinstance(kwargs["config"], dict):
                    kwargs["config"].setdefault(
                        "system_instruction", system_instruction
                    )
            return models.generate_content(**kwargs)

        # Fall back to legacy SDK.
        if hasattr(client, "GenerativeModel"):
            generative_model = client.GenerativeModel(
                model_name,
                **(
                    {"system_instruction": system_instruction}
                    if system_instruction is not None
                    else {}
                ),
            )
            return generative_model.generate_content(contents, **other)

        raise ValueError(
            "Weckr: Gemini client does not expose .models.generate_content "
            "(new SDK) or .GenerativeModel (legacy SDK). Pass a google-genai "
            "or google-generativeai client."
        )

    def flush(self, timeout_seconds: float = 5.0) -> None:
        """Await all in-flight log POSTs. Call before ``sys.exit()`` /
        Lambda return / end of a short-lived CLI script.

        Without this call, daemon-thread teardown can kill the POST before it
        reaches the network — the canonical "my Lambda lost its last log" bug.
        """
        self._logger.flush(timeout_seconds=timeout_seconds)


__all__ = [
    "Weckr",
    "WeckrDowngradeWarning",
    "DEFAULT_LOG_ENDPOINT",
    "DEFAULT_CHECK_ENDPOINT",
]
