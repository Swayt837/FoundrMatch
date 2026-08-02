"""
Discovery and matching: the swipe feed, swipes, matches and unmatching.

Compatibility is scored locally by `compatibility.score_compatibility` — see that
module for why the LLM no longer produces the number.
"""
import os
import re
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from compatibility import score_compatibility
from database import (
    deal_rooms_collection,
    get_utc_now,
    matches_collection,
    messages_collection,
    swipes_collection,
    users_collection,
)
from entitlements import FREE_MAX_MATCHES, premium_active
from matches import ensure_match
from models import SwipeAction
from moderation import assert_not_blocked, blocked_user_ids
from quotas import claim_daily_swipe
from realtime import sio
from serializers import PUBLIC_USER_PROJECTION, public_user

router = APIRouter(prefix="/api", tags=["discovery"])

# How many candidates the discovery feed ranks per request. Scoring is local and
# costs microseconds per pair, so this is bounded by the Mongo read rather than by
# compute — it used to be `limit * 3` because every card cost an LLM call.
DISCOVERY_CANDIDATE_POOL = int(os.getenv("DISCOVERY_CANDIDATE_POOL", "500"))


@router.get("/discovery/cards")
async def get_discovery_cards(
    limit: int = 10,
    offset: int = 0,
    profession: Optional[str] = None,
    availability: Optional[str] = None,
    city: Optional[str] = None,
    country: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get cards for swiping, ranked by compatibility.

    Scoring is now deterministic and local (`compatibility.score_compatibility`),
    so the whole candidate pool is ranked in one pass instead of firing one LLM
    call per card and over-fetching 3x to have something to sort. That removes the
    per-card cost and latency, and makes `offset` a stable cursor: the ranking does
    not change between pages.
    """
    user_id = current_user["user_id"]
    my_profile = current_user.get("profile") or {}

    # Get users already swiped on
    swiped = await swipes_collection.find(
        {"user_id": user_id}
    ).to_list(None)
    swiped_ids = [s["target_user_id"] for s in swiped]

    # Exclude self, already-swiped profiles, and anyone blocked in either direction
    blocked_ids = await blocked_user_ids(user_id)
    exclude_ids = list({*swiped_ids, *blocked_ids, user_id})

    # Build filter query. Free-text filters are escaped before reaching $regex:
    # an unescaped value such as `(a+)+$` triggers catastrophic backtracking.
    query: Dict[str, Any] = {
        "user_id": {"$nin": exclude_ids},
        "onboarding_completed": True,
    }
    if profession:
        query["profile.profession"] = profession
    if availability:
        query["profile.availability"] = availability
    if city:
        query["profile.city"] = {"$regex": f"^{re.escape(city)}$", "$options": "i"}
    if country:
        query["profile.country"] = {"$regex": f"^{re.escape(country)}$", "$options": "i"}

    candidates = await users_collection.find(
        query,
        PUBLIC_USER_PROJECTION
    ).limit(DISCOVERY_CANDIDATE_POOL).to_list(DISCOVERY_CANDIDATE_POOL)

    if not candidates:
        return {"cards": [], "total": 0, "has_more": False}

    cards = [
        {
            "user": public_user(candidate),
            "compatibility": score_compatibility(my_profile, candidate.get("profile") or {}),
        }
        for candidate in candidates
    ]

    # Sort — premium users first, then by compatibility score
    def sort_key(card):
        is_premium = 1 if card["user"].get("premium") else 0
        score = card["compatibility"]["overall_score"]
        return (-is_premium, -score)
    cards.sort(key=sort_key)

    total = len(cards)
    page = cards[max(0, offset):max(0, offset) + limit]

    return {
        "cards": page,
        "total": total,
        "has_more": max(0, offset) + len(page) < total,
    }

@router.post("/swipe")
async def swipe(
    action: SwipeAction,
    current_user: dict = Depends(get_current_user)
):
    """Swipe on a user"""
    user_id = current_user["user_id"]
    target_id = action.target_user_id

    if target_id == user_id:
        raise HTTPException(status_code=400, detail="You cannot swipe on yourself")

    await assert_not_blocked(user_id, target_id)

    # Check if already swiped
    existing = await swipes_collection.find_one({
        "user_id": user_id,
        "target_user_id": target_id
    })

    if existing:
        raise HTTPException(status_code=400, detail="Already swiped on this user")

    # Claim one swipe against the daily quota. This is a single atomic
    # find_one_and_update rather than a read-then-$set: the previous version wrote
    # back `swipes_today + 1` from a value read at request start, so concurrent
    # swipes overwrote each other and the free-tier cap could be walked straight
    # through by firing requests in parallel.
    swipes_today = await claim_daily_swipe(current_user)

    # Record swipe
    swipe_data = {
        "user_id": user_id,
        "target_user_id": target_id,
        "direction": action.direction,
        "created_at": get_utc_now()
    }
    await swipes_collection.insert_one(swipe_data)

    # Check for match (if right swipe)
    if action.direction == "right":
        # Check if target also swiped right
        reciprocal = await swipes_collection.find_one({
            "user_id": target_id,
            "target_user_id": user_id,
            "direction": "right"
        })
        
        if reciprocal:
            # Free tier is capped at FREE_MAX_MATCHES concurrent matches (PRD).
            # Checked at match time rather than at swipe time so the swipe still
            # counts and the pairing completes as soon as they upgrade or unmatch.
            if not premium_active(current_user):
                existing_matches = await matches_collection.count_documents({
                    "$or": [{"user1_id": user_id}, {"user2_id": user_id}]
                })
                if existing_matches >= FREE_MAX_MATCHES:
                    raise HTTPException(
                        status_code=402,
                        detail=(
                            f"Free accounts can hold {FREE_MAX_MATCHES} matches. "
                            "Upgrade to Premium, or unmatch someone to make room."
                        ),
                    )

            # It's a match! Scoring, storage and the notification all live in
            # `matches.ensure_match`, shared with the project-application route —
            # a pair connected through a posting has to end up with exactly the
            # same object as one that swiped, or everything downstream has two
            # cases to handle.
            target_user = await users_collection.find_one(
                {"user_id": target_id},
                PUBLIC_USER_PROJECTION
            )

            match_data, _ = await ensure_match(current_user, target_id, origin="swipe")

            return {
                "matched": True,
                "match_id": match_data["match_id"],
                "user": public_user(target_user),
                "compatibility": match_data["compatibility_score"],
                "swipes_used_today": swipes_today,
            }

    return {"matched": False, "swipes_used_today": swipes_today}

@router.get("/matches")
async def get_matches(
    current_user: dict = Depends(get_current_user)
):
    """
    Get user's matches, each with its unread count and last message.

    The list is ordered by most recent activity rather than match date, so an
    active conversation stays at the top.
    """
    user_id = current_user["user_id"]

    matches = await matches_collection.find({
        "$or": [
            {"user1_id": user_id},
            {"user2_id": user_id}
        ]
    }, {"_id": 0}).sort("created_at", -1).to_list(None)

    if not matches:
        return {"matches": [], "total_unread": 0}

    hidden = await blocked_user_ids(user_id)

    # Batch the two lookups instead of querying per match
    other_ids = []
    for match in matches:
        other_id = match["user2_id"] if match["user1_id"] == user_id else match["user1_id"]
        if other_id not in hidden:
            other_ids.append(other_id)

    users = await users_collection.find(
        {"user_id": {"$in": other_ids}}, PUBLIC_USER_PROJECTION
    ).to_list(None)
    users_by_id = {u["user_id"]: public_user(u) for u in users}

    match_ids = [m["match_id"] for m in matches]
    unread_counts = {
        row["_id"]: row["count"]
        for row in await messages_collection.aggregate([
            {"$match": {
                "match_id": {"$in": match_ids},
                "sender_id": {"$ne": user_id},
                "read": False,
            }},
            {"$group": {"_id": "$match_id", "count": {"$sum": 1}}},
        ]).to_list(None)
    }

    last_messages = {
        row["_id"]: row["last"]
        for row in await messages_collection.aggregate([
            {"$match": {"match_id": {"$in": match_ids}}},
            {"$sort": {"created_at": 1}},
            {"$group": {"_id": "$match_id", "last": {"$last": "$$ROOT"}}},
        ]).to_list(None)
    }

    result = []
    for match in matches:
        other_id = match["user2_id"] if match["user1_id"] == user_id else match["user1_id"]
        other_user = users_by_id.get(other_id)
        if not other_user:
            continue

        last = last_messages.get(match["match_id"])
        result.append({
            "match_id": match["match_id"],
            "user": other_user,
            "compatibility": match.get("compatibility_score"),
            "created_at": match["created_at"],
            "unread_count": unread_counts.get(match["match_id"], 0),
            "last_message": {
                "content": last["content"],
                "sender_id": last["sender_id"],
                "created_at": last["created_at"],
            } if last else None,
            "last_activity": last["created_at"] if last else match["created_at"],
        })

    result.sort(key=lambda m: m["last_activity"], reverse=True)

    return {
        "matches": result,
        "total_unread": sum(m["unread_count"] for m in result),
    }

@router.delete("/matches/{match_id}")
async def unmatch(
    match_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Remove a match, along with its messages and deal room.

    Either participant can unmatch; the other side simply stops seeing the
    conversation.
    """
    match = await matches_collection.find_one({"match_id": match_id})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    if current_user["user_id"] not in [match["user1_id"], match["user2_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")

    await messages_collection.delete_many({"match_id": match_id})
    await deal_rooms_collection.delete_many({"match_id": match_id})
    await matches_collection.delete_one({"match_id": match_id})

    other_id = (
        match["user2_id"] if match["user1_id"] == current_user["user_id"] else match["user1_id"]
    )
    await sio.emit("match_removed", {"match_id": match_id}, room=f"user:{other_id}")

    return {"unmatched": True, "match_id": match_id}
