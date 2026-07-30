"""
Cross-domain access guards.

`require_match_participant` is needed by chat, deal rooms and the AI routes, so it
cannot live inside any one of them without those modules importing each other.
Block-based guards live in `moderation`.
"""
from typing import Any, Dict

from fastapi import HTTPException

from database import matches_collection


async def require_match_participant(match_id: str, user_id: str) -> Dict[str, Any]:
    """Load a match, asserting the caller is one of its two participants."""
    match = await matches_collection.find_one({"match_id": match_id})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    if user_id not in [match["user1_id"], match["user2_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")

    return match
