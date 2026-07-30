"""
Response shaping helpers.

Every endpoint that returns a user document to *someone else* must go through
`public_user`. Mongo projections that simply excluded `password_hash` leaked the
email address, internal settings and swipe counters to any authenticated caller.
"""
from typing import Any, Dict, List, Optional

from entitlements import premium_active


# Projection for reads of other users: only fetch what `public_user` exposes.
PUBLIC_USER_PROJECTION = {
    "_id": 0,
    "user_id": 1,
    "profile": 1,
    "premium": 1,
    "verification": 1,
    "gamification": 1,
    "settings.show_age": 1,
    "onboarding_completed": 1,
    "last_active": 1,
    # Needed to tell an active subscription from a lapsed one; never exposed.
    "premium_expires_at": 1,
}


def public_user(user: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Shape a user document for exposure to other users.

    Drops email, password hash, google id, session/premium bookkeeping and the
    private settings block. Honours the `show_age` preference, which the app
    stored but never applied.
    """
    if not user:
        return None

    profile = dict(user.get("profile") or {})
    if (user.get("settings") or {}).get("show_age") is False:
        profile.pop("age", None)

    return {
        "user_id": user.get("user_id"),
        "profile": profile,
        # premium_active, not the raw flag: a lapsed subscriber must stop showing
        # a PREMIUM badge to other founders and stop getting the discovery boost.
        "premium": premium_active(user),
        "verification": user.get("verification") or {},
        "gamification": user.get("gamification") or {},
    }


def public_users(users: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Shape a list of user documents, dropping anything that failed to load."""
    return [u for u in (public_user(u) for u in users) if u is not None]


def private_user(user: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Shape the *current* user's own document (`/api/auth/me`).

    Keeps email and settings — they belong to the caller — but strips secrets and
    internal counters that the client has no use for.
    """
    if not user:
        return None

    shaped = {k: v for k, v in user.items() if k not in ("_id", "password_hash", "google_id")}
    shaped.pop("daily_swipes_used", None)
    shaped.pop("daily_swipes_date", None)
    return shaped
