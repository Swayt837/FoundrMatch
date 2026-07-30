"""
Blocking and reporting.

A block is one-directional in storage but enforced both ways: once either user
blocks the other, neither appears in the other's discovery feed, matches, chat or
profile lookups. App Store and Play Store review both require this, and so does
any credible trust-and-safety story.
"""
from typing import Any, Dict, List, Set

from fastapi import HTTPException

from database import blocks_collection


async def blocked_user_ids(user_id: str) -> Set[str]:
    """Every user id hidden from `user_id` — blocks they made and blocks against them."""
    docs = await blocks_collection.find(
        {"$or": [{"blocker_id": user_id}, {"blocked_id": user_id}]},
        {"_id": 0, "blocker_id": 1, "blocked_id": 1},
    ).to_list(None)

    hidden: Set[str] = set()
    for doc in docs:
        hidden.add(doc["blocked_id"] if doc["blocker_id"] == user_id else doc["blocker_id"])
    hidden.discard(user_id)
    return hidden


async def is_blocked_between(user_a: str, user_b: str) -> bool:
    """True when a block exists in either direction between two users."""
    existing = await blocks_collection.find_one({
        "$or": [
            {"blocker_id": user_a, "blocked_id": user_b},
            {"blocker_id": user_b, "blocked_id": user_a},
        ]
    })
    return existing is not None


async def assert_not_blocked(user_a: str, user_b: str) -> None:
    """
    Guard for any interaction between two users.

    Answers 404 rather than 403 on purpose: confirming "this person blocked you"
    hands the blocked party information they can act on.
    """
    if user_a == user_b:
        return
    if await is_blocked_between(user_a, user_b):
        raise HTTPException(status_code=404, detail="User not found")


def filter_blocked(items: List[Dict[str, Any]], hidden: Set[str], key: str) -> List[Dict[str, Any]]:
    """Drop items whose `key` field points at a hidden user."""
    return [item for item in items if item.get(key) not in hidden]
