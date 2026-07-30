"""
What a user is allowed to do.

Lives in its own module because `quotas`, `premium` and `serializers` all need it
and importing between them would be circular. It also puts every free-tier limit in
one place instead of scattering magic numbers across endpoints.

Deliberately dependency-free — no FastAPI, no `auth`. That keeps `serializers`
importable without the auth stack, which is what lets its tests run anywhere. The
FastAPI dependency that turns this into a 402 lives in `premium.require_premium`.

Always call `premium_active()` rather than reading `user["premium"]`: a lifetime
purchase never expires but a subscription does, and the raw boolean stays True after
a subscription lapses.
"""
import os
from datetime import datetime, timezone
from typing import Any, Dict

# Free-tier limits, per the PRD's "10 swipes/day, 5 matches, limited chat".
FREE_DAILY_SWIPES = int(os.getenv("FREE_DAILY_SWIPES", "10"))
FREE_MAX_MATCHES = int(os.getenv("FREE_MAX_MATCHES", "5"))


def _as_aware_datetime(value: Any) -> Any:
    """Coerce a stored expiry into an aware datetime, or None if unusable."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value


def premium_active(user: Dict[str, Any]) -> bool:
    """
    Whether this user currently has premium.

    `premium_expires_at` is None for a lifetime plan and set to the paid-through date
    for a subscription. An unparseable value is treated as "no expiry" so a data
    problem never silently removes access someone paid for.
    """
    if not user or not user.get("premium"):
        return False

    expires_at = _as_aware_datetime(user.get("premium_expires_at"))
    if expires_at is None:
        return True

    return expires_at > datetime.now(timezone.utc)
