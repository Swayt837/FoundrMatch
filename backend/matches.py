"""
Creating a match between two founders.

There are two ways a pair ends up connected — a reciprocal swipe, and a project
owner accepting an applicant — and they must produce the same thing. A match
made from a project that lacked a compatibility score, or that no notification
was sent for, would look broken on the other side in ways that are hard to
attribute later.

Idempotent: asking for a match that already exists returns it rather than
creating a second one. Two rows for one pair would split their conversation in
half, and neither half would look wrong.
"""
from typing import Any, Dict, Optional, Tuple

import push
from compatibility import score_compatibility
from database import get_utc_now, matches_collection, users_collection
from realtime import sio
from serializers import PUBLIC_USER_PROJECTION, public_user
import gamification


async def find_match(user_a: str, user_b: str) -> Optional[Dict[str, Any]]:
    """The match between two users, whichever order they are stored in."""
    return await matches_collection.find_one(
        {
            "$or": [
                {"user1_id": user_a, "user2_id": user_b},
                {"user1_id": user_b, "user2_id": user_a},
            ]
        },
        {"_id": 0},
    )


async def ensure_match(
    user_a: Dict[str, Any],
    user_b_id: str,
    origin: str = "swipe",
) -> Tuple[Dict[str, Any], bool]:
    """
    Connect two founders, or return the connection they already have.

    `origin` is recorded on the match so the two routes stay distinguishable
    afterwards — a pair that met through a project posting has a different story
    from one that swiped, and only one of them can be reasoned about from the
    swipe history.

    Returns `(match, created)`.
    """
    user_a_id = user_a["user_id"]

    existing = await find_match(user_a_id, user_b_id)
    if existing:
        return existing, False

    user_b = await users_collection.find_one(
        {"user_id": user_b_id}, PUBLIC_USER_PROJECTION
    )

    # Deterministic and instant, so the match is created in the same request
    # rather than waiting on an LLM round trip.
    compatibility = score_compatibility(
        user_a.get("profile") or {},
        (user_b or {}).get("profile") or {},
    )

    match = {
        "match_id": f"match_{user_a_id[:6]}_{user_b_id[:6]}_{get_utc_now().timestamp()}",
        "user1_id": user_a_id,
        "user2_id": user_b_id,
        "compatibility_score": compatibility,
        "status": "matched",
        "origin": origin,
        "created_at": get_utc_now(),
    }
    await matches_collection.insert_one(match)
    match.pop("_id", None)

    await gamification.award_many([user_a_id, user_b_id], "matches_count")

    # Reaches the other founder only if they have a socket open; the match is in
    # their list either way.
    await sio.emit(
        "new_match",
        {
            "match_id": match["match_id"],
            "user": public_user(user_a),
            "compatibility": compatibility,
            "origin": origin,
        },
        room=f"user:{user_b_id}",
    )

    # And a push, which is the half that reaches them when the app is closed —
    # which is most of the time, and the whole point of a matching product.
    name = (user_a.get("profile") or {}).get("name") or "A founder"
    push.send_soon(
        [user_b_id],
        "New match",
        f"{name} matched with you — {round(compatibility.get('overall_score', 0))}% compatible.",
        {"type": "match", "match_id": match["match_id"]},
    )

    return match, True
