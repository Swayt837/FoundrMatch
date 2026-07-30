"""
Shared FastAPI dependencies.

Rate limiters live here rather than in `server` so routers can depend on them
without importing the app module.
"""
from rate_limit import RateLimiter

# Auth endpoints are brute-force targets; the AI routes cost real tokens per call.
auth_rate_limit = RateLimiter("auth", limit=10, window=60)
ai_rate_limit = RateLimiter("ai", limit=20, window=60)
