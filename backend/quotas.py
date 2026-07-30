"""
Free-tier usage quotas.

Single source of truth for the daily swipe allowance, shared by `/api/swipe` and
`/api/premium/me` — the limit used to be hardcoded in both places.
"""
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import HTTPException
from pymongo import ReturnDocument

from database import users_collection
from entitlements import FREE_DAILY_SWIPES, premium_active


def today_key() -> str:
    """UTC day bucket the counters are keyed on."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def swipes_used_today(user: Dict[str, Any]) -> int:
    """Swipes consumed today, reading a user document as-is (no DB round trip)."""
    if user.get("daily_swipes_date") != today_key():
        return 0
    return int(user.get("daily_swipes_used", 0) or 0)


async def claim_daily_swipe(user: Dict[str, Any]) -> int:
    """
    Atomically consume one swipe from today's allowance.

    Returns the number of swipes used after this one. Raises 402 for a free user
    who has already reached the cap.

    The day-rollover reset, the increment and the cap check happen in a single
    `find_one_and_update` with a pipeline update, so parallel requests cannot each
    read the same counter and write back the same value.
    """
    today = today_key()
    # premium_active, not the raw flag: a lapsed subscriber is back on the free tier.
    is_premium = premium_active(user)

    query: Dict[str, Any] = {"user_id": user["user_id"]}
    if not is_premium:
        # Allowed when the stored counter is from an earlier day (fresh allowance)
        # or when today's usage is still under the cap.
        query["$or"] = [
            {"daily_swipes_date": {"$ne": today}},
            {"daily_swipes_used": {"$lt": FREE_DAILY_SWIPES}},
        ]

    updated = await users_collection.find_one_and_update(
        query,
        [{
            "$set": {
                "daily_swipes_used": {
                    "$cond": [
                        {"$eq": ["$daily_swipes_date", today]},
                        {"$add": [{"$ifNull": ["$daily_swipes_used", 0]}, 1]},
                        1,
                    ]
                },
                "daily_swipes_date": today,
            }
        }],
        projection={"_id": 0, "daily_swipes_used": 1},
        return_document=ReturnDocument.AFTER,
    )

    if updated is None:
        raise HTTPException(
            status_code=402,
            detail="Daily swipe limit reached. Upgrade to Premium for unlimited swipes.",
        )

    return int(updated.get("daily_swipes_used", 0))
