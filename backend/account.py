"""
Account routes: user settings, blocking, reporting and account deletion.

These are the pieces the app was missing to be publishable — both stores require
a way to block and report another user and to delete your own account, and GDPR
requires the deletion to actually remove personal data.
"""
import re
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import (
    blocks_collection,
    compatibility_cache_collection,
    deal_rooms_collection,
    get_utc_now,
    matches_collection,
    messages_collection,
    payment_transactions_collection,
    projects_collection,
    reports_collection,
    swipes_collection,
    user_sessions_collection,
    users_collection,
)
from serializers import public_user, PUBLIC_USER_PROJECTION

router = APIRouter(prefix="/api", tags=["account"])


# ===== Settings =====

class SettingsUpdate(BaseModel):
    """Every field optional — this is a partial update."""
    notifications_enabled: Optional[bool] = None
    distance_preference: Optional[int] = Field(default=None, ge=0, le=20000)
    show_age: Optional[bool] = None


DEFAULT_SETTINGS = {
    "notifications_enabled": True,
    "distance_preference": 100,
    "show_age": True,
}


@router.get("/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    """Current user's settings, with defaults filled in for older documents."""
    stored = current_user.get("settings") or {}
    return {**DEFAULT_SETTINGS, **{k: v for k, v in stored.items() if k in DEFAULT_SETTINGS}}


@router.patch("/settings")
async def update_settings(
    updates: SettingsUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Partially update the current user's settings."""
    provided = updates.model_dump(exclude_none=True)
    if not provided:
        raise HTTPException(status_code=400, detail="No settings provided")

    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {
            **{f"settings.{key}": value for key, value in provided.items()},
            "updated_at": get_utc_now(),
        }},
    )

    stored = {**DEFAULT_SETTINGS, **(current_user.get("settings") or {}), **provided}
    return {k: stored[k] for k in DEFAULT_SETTINGS}


# ===== Blocking =====

@router.post("/users/{user_id}/block")
async def block_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """
    Block another user, and tear down anything that already connects the two.

    Blocking removes the match and its messages so neither side keeps a live
    thread with someone they blocked.
    """
    me = current_user["user_id"]
    if user_id == me:
        raise HTTPException(status_code=400, detail="You cannot block yourself")

    target = await users_collection.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    await blocks_collection.update_one(
        {"blocker_id": me, "blocked_id": user_id},
        {"$set": {"blocker_id": me, "blocked_id": user_id, "created_at": get_utc_now()}},
        upsert=True,
    )

    removed = await _teardown_connection(me, user_id)
    return {"blocked": True, "user_id": user_id, **removed}


@router.delete("/users/{user_id}/block")
async def unblock_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Lift a block this user created. Does not restore the deleted match."""
    result = await blocks_collection.delete_one(
        {"blocker_id": current_user["user_id"], "blocked_id": user_id}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Block not found")
    return {"blocked": False, "user_id": user_id}


@router.get("/users/blocked")
async def list_blocked(current_user: dict = Depends(get_current_user)):
    """Users the current user has blocked, so the settings screen can list them."""
    docs = await blocks_collection.find(
        {"blocker_id": current_user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(None)

    blocked_ids = [d["blocked_id"] for d in docs]
    if not blocked_ids:
        return {"blocked": []}

    users = await users_collection.find(
        {"user_id": {"$in": blocked_ids}}, PUBLIC_USER_PROJECTION
    ).to_list(None)
    by_id = {u["user_id"]: public_user(u) for u in users}

    return {
        "blocked": [
            {"user": by_id.get(d["blocked_id"]), "created_at": d["created_at"]}
            for d in docs
            if by_id.get(d["blocked_id"])
        ]
    }


# ===== Reporting =====

ReportReason = Literal[
    "spam", "harassment", "inappropriate_content", "fake_profile", "scam", "other"
]


class ReportCreate(BaseModel):
    reason: ReportReason
    details: str = Field(default="", max_length=2000)
    also_block: bool = True


@router.post("/users/{user_id}/report")
async def report_user(
    user_id: str,
    body: ReportCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Report a user for review, blocking them by default.

    Reports are stored for a human to triage; nothing is auto-actioned.
    """
    me = current_user["user_id"]
    if user_id == me:
        raise HTTPException(status_code=400, detail="You cannot report yourself")

    target = await users_collection.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    report = {
        "report_id": f"report_{get_utc_now().timestamp()}",
        "reporter_id": me,
        "reported_id": user_id,
        "reason": body.reason,
        "details": body.details,
        "status": "pending",
        "created_at": get_utc_now(),
    }
    await reports_collection.insert_one(report)

    blocked = False
    if body.also_block:
        await blocks_collection.update_one(
            {"blocker_id": me, "blocked_id": user_id},
            {"$set": {"blocker_id": me, "blocked_id": user_id, "created_at": get_utc_now()}},
            upsert=True,
        )
        await _teardown_connection(me, user_id)
        blocked = True

    return {"reported": True, "blocked": blocked, "report_id": report["report_id"]}


# ===== Account deletion =====

class DeleteAccountRequest(BaseModel):
    """Typing the confirmation phrase guards against an accidental tap."""
    confirm: str


@router.delete("/account")
async def delete_account(
    body: DeleteAccountRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Permanently delete the current user's account and personal data.

    Payment transactions are kept but stripped of the user reference: they are
    financial records, and orphaning them loses the audit trail.
    """
    if body.confirm.strip().upper() != "DELETE":
        raise HTTPException(
            status_code=400,
            detail="Confirmation required: send {\"confirm\": \"DELETE\"}",
        )

    me = current_user["user_id"]

    # Matches involving this user, and everything hanging off them
    matches = await matches_collection.find(
        {"$or": [{"user1_id": me}, {"user2_id": me}]}, {"_id": 0, "match_id": 1}
    ).to_list(None)
    match_ids = [m["match_id"] for m in matches]

    if match_ids:
        await messages_collection.delete_many({"match_id": {"$in": match_ids}})
        await deal_rooms_collection.delete_many({"match_id": {"$in": match_ids}})
        await matches_collection.delete_many({"match_id": {"$in": match_ids}})

    await swipes_collection.delete_many({"$or": [{"user_id": me}, {"target_user_id": me}]})
    await projects_collection.delete_many({"user_id": me})
    await projects_collection.update_many(
        {"applicants.user_id": me},
        {"$pull": {"applicants": {"user_id": me}}},
    )
    await blocks_collection.delete_many({"$or": [{"blocker_id": me}, {"blocked_id": me}]})
    await reports_collection.delete_many({"reporter_id": me})
    await user_sessions_collection.delete_many({"user_id": me})
    await compatibility_cache_collection.delete_many(
        {"pair_key": {"$regex": re.escape(me)}}
    )
    await payment_transactions_collection.update_many(
        {"user_id": me},
        {"$set": {"user_id": "deleted", "deleted_at": get_utc_now()}},
    )
    await users_collection.delete_one({"user_id": me})

    return {"deleted": True}


# ===== Helpers =====

async def _teardown_connection(user_a: str, user_b: str) -> Dict[str, Any]:
    """Delete any match, messages and deal room shared by two users."""
    matches = await matches_collection.find(
        {"$or": [
            {"user1_id": user_a, "user2_id": user_b},
            {"user1_id": user_b, "user2_id": user_a},
        ]},
        {"_id": 0, "match_id": 1},
    ).to_list(None)

    match_ids = [m["match_id"] for m in matches]
    if not match_ids:
        return {"removed_match": False}

    await messages_collection.delete_many({"match_id": {"$in": match_ids}})
    await deal_rooms_collection.delete_many({"match_id": {"$in": match_ids}})
    await matches_collection.delete_many({"match_id": {"$in": match_ids}})
    return {"removed_match": True}
