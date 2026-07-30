"""
In-process sliding-window rate limiting.

Protects the endpoints where an unauthenticated or cheap request costs us real
money or lets an attacker brute-force: auth and the LLM-backed routes. Good
enough for a single-instance deployment; move to Redis when the API scales out.
"""
import os
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from fastapi import HTTPException, Request

RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() != "false"

_hits: Dict[str, Deque[float]] = defaultdict(deque)


def _client_key(request: Request, bucket: str) -> str:
    """Identify the caller: authenticated token when present, else client IP."""
    auth = request.headers.get("authorization", "")
    if auth:
        return f"{bucket}:token:{auth[-32:]}"
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (
        request.client.host if request.client else "unknown"
    )
    return f"{bucket}:ip:{ip}"


class RateLimiter:
    """
    FastAPI dependency: `Depends(RateLimiter("auth", limit=10, window=60))`.

    Raises 429 with a `Retry-After` header once `limit` calls have been made
    within `window` seconds.
    """

    def __init__(self, bucket: str, limit: int, window: int):
        self.bucket = bucket
        self.limit = limit
        self.window = window

    async def __call__(self, request: Request) -> None:
        if not RATE_LIMIT_ENABLED:
            return

        key = _client_key(request, self.bucket)
        now = time.monotonic()
        hits = _hits[key]

        while hits and now - hits[0] > self.window:
            hits.popleft()

        if len(hits) >= self.limit:
            retry_after = max(1, int(self.window - (now - hits[0])))
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please slow down.",
                headers={"Retry-After": str(retry_after)},
            )

        hits.append(now)


def reset(bucket: Optional[str] = None) -> None:
    """Clear counters — used by tests."""
    if bucket is None:
        _hits.clear()
        return
    for key in [k for k in _hits if k.startswith(f"{bucket}:")]:
        del _hits[key]
