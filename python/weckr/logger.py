from __future__ import annotations

"""Fire-and-forget logging to the Weckr ingest endpoint.

Uses urllib (stdlib) so the SDK has zero runtime dependencies. POSTs run on
daemon threads, but tracked so :meth:`Logger.flush` can wait for in-flight
sends before process exit. Otherwise the daemon threads get torn down before
the POST reaches the network, which is the canonical "Lambda lost the last
log" bug.

Transient failures (network error, timeout, 5xx, 429) are retried with a
short bounded backoff instead of being dropped, because a dashboard that
silently loses rows during a blip is not a source of truth you can bill
against. Permanent rejections (401, 400, 429-less 4xx) are never retried:
the event will never be accepted, so retrying only burns requests. The retry
buffer is bounded, and drops oldest-first when full, because an unbounded
queue inside a customer's process is a worse failure than a missing row.
"""

import json
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple


DEFAULT_LOG_ENDPOINT = "https://app.useweckr.com/api/v1/log"

#: Retry delays in seconds. Short enough to ride out a blip, bounded so a long
#: outage cannot keep a process alive or hammer a struggling server.
BACKOFF_SECONDS = (1.0, 5.0, 20.0)

#: Default cap on events held for retry (~100KB of payloads).
DEFAULT_MAX_BUFFERED_EVENTS = 500


def _is_retryable_status(status: int) -> bool:
    """429 and 5xx may still succeed later; other 4xx never will."""
    return status == 429 or status >= 500


class Logger:
    """Stateful fire-and-forget logger with flush()."""

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        timeout: float = 5.0,
        on_error: Optional[Callable[[BaseException], None]] = None,
        max_buffered_events: int = DEFAULT_MAX_BUFFERED_EVENTS,
    ) -> None:
        self.endpoint = endpoint
        self.api_key = api_key
        self.timeout = timeout
        self.on_error = on_error
        self.max_buffered_events = max_buffered_events
        self._in_flight: set = set()
        self._lock = threading.Lock()
        # (payload, attempt) pairs awaiting a retry, oldest first.
        self._buffer: List[Tuple[Dict[str, Any], int]] = []
        self._timer: Optional[threading.Timer] = None

    def pending(self) -> int:
        """Events currently waiting on a retry. For tests and diagnostics."""
        with self._lock:
            return len(self._buffer)

    def log(self, payload: Dict[str, Any]) -> None:
        self._spawn(payload, 0)

    def _spawn(self, payload: Dict[str, Any], attempt: int) -> None:
        thread = threading.Thread(
            target=self._send, args=(payload, attempt), daemon=True
        )
        with self._lock:
            self._in_flight.add(thread)
        thread.start()

    def _report(self, err: BaseException) -> None:
        if self.on_error is not None:
            try:
                self.on_error(err)
            except Exception:
                pass

    def _enqueue(self, payload: Dict[str, Any], attempt: int) -> None:
        if self.max_buffered_events <= 0:
            return
        if attempt >= len(BACKOFF_SECONDS):
            self._report(Exception("Weckr: dropping event after final retry attempt."))
            return
        start_timer = False
        with self._lock:
            if len(self._buffer) >= self.max_buffered_events:
                self._buffer.pop(0)
                dropped = True
            else:
                dropped = False
            self._buffer.append((payload, attempt))
            if self._timer is None:
                start_timer = True
        if dropped:
            self._report(Exception("Weckr: retry buffer full, oldest event dropped."))
        if start_timer:
            timer = threading.Timer(BACKOFF_SECONDS[attempt], self._drain)
            timer.daemon = True
            with self._lock:
                self._timer = timer
            timer.start()

    def _drain(self) -> None:
        with self._lock:
            batch = self._buffer[:]
            self._buffer.clear()
            self._timer = None
        for payload, attempt in batch:
            self._spawn(payload, attempt)

    def flush(self, timeout_seconds: float = 5.0) -> None:
        """Wait for in-flight POSTs to complete (up to ``timeout_seconds`` total).

        Call this before ``sys.exit(0)`` / Lambda return / end of a short-lived
        CLI run, otherwise daemon-thread teardown can kill the POST in flight.
        """
        # Retry anything queued rather than let process exit drop it.
        with self._lock:
            timer = self._timer
            self._timer = None
        if timer is not None:
            timer.cancel()
        if self.pending() > 0:
            self._drain()
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

    def _send(self, payload: Dict[str, Any], attempt: int = 0) -> None:
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
                if resp.status >= 400:
                    self._report(Exception(f"Weckr log failed: HTTP {resp.status}"))
                    if _is_retryable_status(resp.status):
                        self._enqueue(payload, attempt + 1)
        except urllib.error.HTTPError as err:
            # urllib raises on 4xx/5xx rather than returning them.
            self._report(err)
            if _is_retryable_status(getattr(err, "code", 0)):
                self._enqueue(payload, attempt + 1)
        except Exception as err:
            # Network error / timeout: the event may still land on a retry.
            self._report(err)
            self._enqueue(payload, attempt + 1)
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
