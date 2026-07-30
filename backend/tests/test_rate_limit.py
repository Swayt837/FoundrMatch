"""
Rate limiter tests.

Covers the sliding window that protects auth and the LLM-backed routes.

Run with: pytest backend/tests -o addopts=''
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

pytest.importorskip("fastapi", reason="rate_limit depends on FastAPI's HTTPException")

from fastapi import HTTPException  # noqa: E402

import rate_limit  # noqa: E402
from rate_limit import RateLimiter, reset  # noqa: E402


class FakeClient:
    def __init__(self, host: str):
        self.host = host


class FakeRequest:
    """Minimal stand-in for starlette's Request."""

    def __init__(self, ip: str = "1.2.3.4", token: str | None = None):
        self.headers = {"authorization": f"Bearer {token}"} if token else {}
        self.client = FakeClient(ip)


@pytest.fixture(autouse=True)
def clean_counters():
    reset()
    rate_limit.RATE_LIMIT_ENABLED = True
    yield
    reset()


async def call(limiter: RateLimiter, request: FakeRequest):
    await limiter(request)  # type: ignore[arg-type]


class TestRateLimiter:
    @pytest.mark.asyncio
    async def test_allows_calls_up_to_the_limit(self):
        limiter = RateLimiter("test", limit=3, window=60)
        request = FakeRequest()
        for _ in range(3):
            await call(limiter, request)

    @pytest.mark.asyncio
    async def test_blocks_past_the_limit_with_429(self):
        limiter = RateLimiter("test", limit=2, window=60)
        request = FakeRequest()
        await call(limiter, request)
        await call(limiter, request)

        with pytest.raises(HTTPException) as excinfo:
            await call(limiter, request)

        assert excinfo.value.status_code == 429
        assert "Retry-After" in (excinfo.value.headers or {})

    @pytest.mark.asyncio
    async def test_callers_are_counted_separately_by_ip(self):
        limiter = RateLimiter("test", limit=1, window=60)
        await call(limiter, FakeRequest(ip="1.1.1.1"))
        # A different caller must not be affected by the first one's usage
        await call(limiter, FakeRequest(ip="2.2.2.2"))

    @pytest.mark.asyncio
    async def test_authenticated_callers_are_counted_by_token(self):
        limiter = RateLimiter("test", limit=1, window=60)
        await call(limiter, FakeRequest(token="token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
        await call(limiter, FakeRequest(token="token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"))

    @pytest.mark.asyncio
    async def test_buckets_are_independent(self):
        auth = RateLimiter("auth", limit=1, window=60)
        ai = RateLimiter("ai", limit=1, window=60)
        request = FakeRequest()
        await call(auth, request)
        # Spending the auth allowance must not spend the AI allowance
        await call(ai, request)

    @pytest.mark.asyncio
    async def test_window_expiry_frees_the_allowance(self):
        limiter = RateLimiter("test", limit=1, window=0)  # everything is instantly stale
        request = FakeRequest()
        await call(limiter, request)
        await call(limiter, request)

    @pytest.mark.asyncio
    async def test_disabled_limiter_never_blocks(self):
        rate_limit.RATE_LIMIT_ENABLED = False
        limiter = RateLimiter("test", limit=1, window=60)
        request = FakeRequest()
        for _ in range(5):
            await call(limiter, request)
