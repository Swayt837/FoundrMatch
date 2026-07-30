"""
AI routes: compatibility narrative, premium deep report, business ideas, copilot.

The compatibility *score* is computed locally (see `compatibility`); the model is
used only for the things an algorithm cannot do, and only on demand.
"""
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from access import require_match_participant
from ai_service import ai_service
from auth import get_current_user
from compatibility import dimension_breakdown, score_compatibility
from database import get_utc_now, users_collection
from deps import ai_rate_limit
from moderation import assert_not_blocked
from premium import require_premium
from serializers import PUBLIC_USER_PROJECTION, public_user

router = APIRouter(prefix="/api", tags=["ai"])


@router.get("/ai/business-ideas/{match_id}", dependencies=[Depends(ai_rate_limit)])
async def get_business_ideas(
    match_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Generate business ideas for a match"""
    match = await require_match_participant(match_id, current_user["user_id"])

    # Get both users
    user1 = await users_collection.find_one(
        {"user_id": match["user1_id"]},
        {"_id": 0, "profile": 1}
    )
    user2 = await users_collection.find_one(
        {"user_id": match["user2_id"]},
        {"_id": 0, "profile": 1}
    )
    
    ideas = await ai_service.generate_business_ideas(
        user1.get("profile", {}),
        user2.get("profile", {}),
        count=5
    )

    if not ideas:
        # Be explicit instead of returning one hardcoded "SaaS Platform" idea
        # dressed up as a tailored AI suggestion.
        raise HTTPException(
            status_code=503,
            detail="Idea generation is temporarily unavailable. Please try again shortly."
        )

    return {"ideas": ideas}

async def _scored_pair(current_user: dict, other_user_id: str):
    """Load another user and score the pair. Shared by the two endpoints below."""
    await assert_not_blocked(current_user["user_id"], other_user_id)

    other = await users_collection.find_one({"user_id": other_user_id}, PUBLIC_USER_PROJECTION)
    if not other:
        raise HTTPException(status_code=404, detail="User not found")

    my_profile = current_user.get("profile") or {}
    their_profile = other.get("profile") or {}
    return other, my_profile, their_profile, score_compatibility(my_profile, their_profile)

@router.get("/compatibility/{user_id}", dependencies=[Depends(ai_rate_limit)])
async def get_compatibility(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Full compatibility breakdown against one user, with an AI narrative.

    The scores come from the local engine; the LLM only writes the narrative, and
    only when a user actually opens a profile — not once per card in the feed. The
    narrative is cached by pair so re-opening a profile is free.
    """
    from database import db as mongo_db

    other, my_profile, their_profile, scores = await _scored_pair(current_user, user_id)

    pair_key = "-".join(sorted([current_user["user_id"], user_id]))
    cache = mongo_db.compatibility_cache

    cached = await cache.find_one({"pair_key": pair_key}, {"_id": 0, "explanation": 1})
    narrative = (cached or {}).get("explanation")

    if not narrative:
        narrative = await ai_service.explain_compatibility(my_profile, their_profile, scores)
        if narrative:
            await cache.update_one(
                {"pair_key": pair_key},
                {"$set": {
                    "pair_key": pair_key,
                    "explanation": narrative,
                    "created_at": get_utc_now(),
                }},
                upsert=True,
            )

    return {
        "user": public_user(other),
        "compatibility": {
            **scores,
            # Prefer the narrative, fall back to the factual summary the engine
            # already produced rather than showing nothing.
            "explanation": narrative or scores["explanation"],
            "narrative_available": bool(narrative),
        },
        "breakdown": dimension_breakdown(scores),
    }

@router.get("/compatibility/{user_id}/report", dependencies=[Depends(ai_rate_limit)])
async def get_compatibility_report(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Premium: deep compatibility report with founder-risk detection.

    This is the paywall's "Deep AI compatibility report" benefit. Gated on premium
    because it is the expensive call, and cached by pair.
    """
    require_premium(current_user)

    from database import db as mongo_db

    other, my_profile, their_profile, scores = await _scored_pair(current_user, user_id)

    pair_key = "-".join(sorted([current_user["user_id"], user_id]))
    cache = mongo_db.compatibility_cache

    cached = await cache.find_one({"pair_key": pair_key}, {"_id": 0, "report": 1})
    report = (cached or {}).get("report")

    if not report:
        report = await ai_service.deep_compatibility_report(my_profile, their_profile, scores)
        if not report:
            raise HTTPException(
                status_code=503,
                detail="Report generation is temporarily unavailable. Please try again shortly.",
            )
        await cache.update_one(
            {"pair_key": pair_key},
            {"$set": {"pair_key": pair_key, "report": report, "created_at": get_utc_now()}},
            upsert=True,
        )

    return {
        "user": public_user(other),
        "compatibility": scores,
        "breakdown": dimension_breakdown(scores),
        "report": report,
    }

class AICopilotRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: List[Dict[str, str]] = []


@router.post(
    "/ai/copilot/chat",
    dependencies=[Depends(ai_rate_limit), Depends(require_premium)],
)
async def copilot_chat(
    payload: AICopilotRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Ask the copilot a question, with the caller's profile as context.

    The prompt and the model configuration live in `ai_service` like every other AI
    feature — this route used to build its own client with its own hardcoded model,
    which meant changing the model in one place silently missed this endpoint.
    """
    profile = current_user.get("profile") or {}

    response = await ai_service.business_copilot(
        message=payload.message,
        context={
            "profession": profile.get("profession", "founder"),
            "skills": (profile.get("skills") or [])[:5],
            "experience": profile.get("experience", "not specified"),
            "objectives": (profile.get("objectives") or [])[:3],
        },
    )

    if response is None:
        # Either no API key is configured or the call failed. 503 says "try later",
        # which is true, where the previous 500 blamed the request.
        raise HTTPException(
            status_code=503,
            detail="The AI copilot is temporarily unavailable. Please try again shortly.",
        )

    return {"response": response}
