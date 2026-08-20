"""Retry-buffer behaviour for the Python logger.

Mirrors typescript/test/logger.retry.test.ts so the two SDKs stay in parity.
"""
import threading
import urllib.error
from typing import Any, Dict

import pytest

from weckr.logger import Logger, BACKOFF_SECONDS


def _payload(event_id: str) -> Dict[str, Any]:
    return {
        "userId": "u_1",
        "feature": "chat",
        "model": "gpt-5.4-mini",
        "provider": "openai",
        "inputTokens": 10,
        "outputTokens": 20,
        "costUsd": 0.001,
        "latencyMs": 12,
        "eventId": event_id,
    }


class _Resp:
    def __init__(self, status: int) -> None:
        self.status = status

    def read(self) -> bytes:
        return b""

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _patch_urlopen(monkeypatch, behaviour):
    calls = {"n": 0}

    def fake(req, timeout=None):
        calls["n"] += 1
        return behaviour(calls["n"])

    monkeypatch.setattr("urllib.request.urlopen", fake)
    return calls


def test_permanent_rejection_is_not_retried(monkeypatch):
    def behaviour(n):
        raise urllib.error.HTTPError("u", 401, "Unauthorized", {}, None)

    calls = _patch_urlopen(monkeypatch, behaviour)
    log = Logger(endpoint="https://e", api_key="wk_x", on_error=lambda e: None)
    log.log(_payload("a"))
    log.flush(1.0)
    assert calls["n"] == 1
    assert log.pending() == 0


def test_retryable_failure_is_buffered(monkeypatch):
    def behaviour(n):
        raise urllib.error.HTTPError("u", 503, "Unavailable", {}, None)

    _patch_urlopen(monkeypatch, behaviour)
    log = Logger(endpoint="https://e", api_key="wk_x", on_error=lambda e: None)
    log.log(_payload("b"))
    for t in list(log._in_flight):
        t.join(timeout=2)
    assert log.pending() == 1


def test_network_error_is_buffered(monkeypatch):
    def behaviour(n):
        raise OSError("connection reset")

    _patch_urlopen(monkeypatch, behaviour)
    log = Logger(endpoint="https://e", api_key="wk_x", on_error=lambda e: None)
    log.log(_payload("c"))
    for t in list(log._in_flight):
        t.join(timeout=2)
    assert log.pending() == 1


def test_buffer_is_bounded(monkeypatch):
    def behaviour(n):
        raise OSError("down")

    _patch_urlopen(monkeypatch, behaviour)
    log = Logger(
        endpoint="https://e", api_key="wk_x", on_error=lambda e: None, max_buffered_events=2
    )
    for i in range(10):
        log.log(_payload(f"d{i}"))
    for t in list(log._in_flight):
        t.join(timeout=2)
    assert log.pending() <= 2


def test_zero_buffer_keeps_old_behaviour(monkeypatch):
    def behaviour(n):
        raise OSError("down")

    _patch_urlopen(monkeypatch, behaviour)
    log = Logger(
        endpoint="https://e", api_key="wk_x", on_error=lambda e: None, max_buffered_events=0
    )
    log.log(_payload("e"))
    for t in list(log._in_flight):
        t.join(timeout=2)
    assert log.pending() == 0


def test_success_leaves_nothing_buffered(monkeypatch):
    _patch_urlopen(monkeypatch, lambda n: _Resp(200))
    log = Logger(endpoint="https://e", api_key="wk_x", on_error=lambda e: None)
    log.log(_payload("f"))
    log.flush(1.0)
    assert log.pending() == 0


def test_backoff_schedule_is_bounded():
    assert len(BACKOFF_SECONDS) == 3
    assert all(b > 0 for b in BACKOFF_SECONDS)
