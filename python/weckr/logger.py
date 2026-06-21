from __future__ import annotations

"""Fire-and-forget logging to the Weckr ingest endpoint.

Uses urllib (stdlib) so the SDK has zero runtime dependencies. POSTs run on
daemon threads, but tracked so :meth:`Logger.flush` can wait for in-flight
sends before process exit. Otherwise the daemon threads get torn down before
the POST reaches the network, which is the canonical "Lambda lost the last
log" bug.
"""

import json
import threading
import urllib.request
from typing import Any, Callable, Dict, Optional


DEFAULT_LOG_ENDPOINT = "https://app.useweckr.com/api/v1/log"


class Logger:
    """Stateful fire-and-forget logger with flush()."""

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        timeout: float = 5.0,
        on_error: Optional[Callable[[BaseException], None]] = None,
    ) -> None:
        self.endpoint = endpoint
        self.api_key = api_key
        self.timeout = timeout
        self.on_error = on_error
        self._in_flight: set = set()
        self._lock = threading.Lock()

    def log(self, payload: Dict[str, Any]) -> None:
        thread = threading.Thread(
            target=self._send, args=(payload,), daemon=True
        )
        with self._lock:
            self._in_flight.add(thread)
        thread.start()

    def flush(self, timeout_seconds: float = 5.0) -> None:
        """Wait for in-flight POSTs to complete (up to ``timeout_seconds`` total).

        Call this before ``sys.exit(0)`` / Lambda return / end of a short-lived
        CLI run, otherwise daemon-thread teardown can kill the POST in flight.
        """
        with self._lock:
            pending = list(self._in_flight)
        deadline = None
        if timeout_seconds > 0:
            import time as _t
            deadline = _t.time() + timeout_seconds
        for t in pending:
            remaining = None
            if deadline is not None:
                import time as _t
                remaining = max(0.0, deadline - _t.time())
            t.join(timeout=remaining)

    def _send(self, payload: Dict[str, Any]) -> None:
        try:
            body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                self.endpoint,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": self.api_key,
                },
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                resp.read()
                if resp.status >= 400 and self.on_error is not None:
                    try:
                        self.on_error(
                            Exception(f"Weckr log failed: HTTP {resp.status}")
                        )
                    except Exception:
                        pass
        except Exception as err:
            if self.on_error is not None:
                try:
                    self.on_error(err)
                except Exception:
                    pass
        finally:
            with self._lock:
                self._in_flight.discard(threading.current_thread())


def fire_and_forget_log(
    *,
    endpoint: str,
    api_key: str,
    payload: Dict[str, Any],
    timeout: float = 5.0,
    on_error: Optional[Callable[[BaseException], None]] = None,
) -> None:
    """Backward-compat: spawn a daemon thread that POSTs the payload.

    Prefer using ``Logger.log`` from a per-Weckr instance so you can
    :meth:`Logger.flush` before process exit.
    """
    logger = Logger(endpoint=endpoint, api_key=api_key, timeout=timeout, on_error=on_error)
    logger.log(payload)


__all__ = ["Logger", "fire_and_forget_log", "DEFAULT_LOG_ENDPOINT"]
