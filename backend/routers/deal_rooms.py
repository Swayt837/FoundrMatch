"""
Deal rooms: the shared workspace a matched pair uses to start building.

Creating one is a Premium feature, per the PRD.

The room document has always carried `documents`, `decisions` and `equity_split`
fields that nothing ever wrote to. The endpoints below fill them in, and the three
have deliberately different semantics:

- **Documents** are links or uploaded files. Links stay because founders keep their
  deck in Drive anyway and a link never goes stale; uploads exist for what a link
  cannot carry — the signed agreement, which belongs to the pair rather than to one
  person's Drive. Uploaded files are read through short-lived signed URLs issued
  only after the caller is checked against the room, never through a public link.
- **Decisions** need agreement from both founders, because the point of a written
  decision log is that neither party can later claim they never signed off.
- **Equity** needs agreement too, and is validated to sum to 100% across exactly the
  room's participants. An equity tab that lets two founders each believe they hold
  60% is worse than no equity tab.
"""
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import storage
from access import require_room_participant
from ai_service import ai_service
from auth import get_current_user
from database import deal_rooms_collection, get_utc_now, matches_collection, users_collection
from deps import ai_rate_limit
from models import DealRoomCreate
from premium import require_premium
import gamification

router = APIRouter(prefix="/api", tags=["deal-rooms"])

# Equity percentages are floats, so an exact 100 is not something to require.
EQUITY_TOLERANCE = 0.01

DOCUMENT_TYPES = {"pitch_deck", "legal", "financial", "product", "other"}


async def _with_participants(room: Dict[str, Any]) -> Dict[str, Any]:
    """
    Attach `{user_id: {"name": ...}}` for the room's members.

    The equity and decisions tabs have to name people — "50% to user_a3f9" is not a
    usable agreement. Names only, deliberately: photos are base64 blobs inside the
    user document, and the room is refetched after every mutation.
    """
    members = await users_collection.find(
        {"user_id": {"$in": room.get("participants", [])}},
        {"_id": 0, "user_id": 1, "profile.name": 1},
    ).to_list(None)

    room["participant_profiles"] = {
        member["user_id"]: {"name": (member.get("profile") or {}).get("name")}
        for member in members
    }
    return room


async def _touch(room_id: str, **set_fields: Any) -> None:
    """Apply updates to a room, always bumping `updated_at`."""
    await deal_rooms_collection.update_one(
        {"room_id": room_id},
        {"$set": {**set_fields, "updated_at": get_utc_now()}},
    )


@router.post("/deal-rooms/create", dependencies=[Depends(require_premium)])
async def create_deal_room(
    data: DealRoomCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a deal room for a match"""
    # Verify match
    match = await matches_collection.find_one({"match_id": data.match_id})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    user_id = current_user["user_id"]
    if user_id not in [match["user1_id"], match["user2_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")

    # One room per match: the client fetches by match id, so a second room would be
    # unreachable while silently splitting the pair's work in two.
    existing = await deal_rooms_collection.find_one({"match_id": data.match_id}, {"_id": 0})
    if existing:
        return await _with_participants(existing)

    # Create deal room
    room_data = {
        "room_id": f"room_{data.match_id}_{get_utc_now().timestamp()}",
        "match_id": data.match_id,
        "participants": [match["user1_id"], match["user2_id"]],
        "project_name": data.project_name,
        "vision": data.vision,
        "objectives": [],
        "tasks": [],
        "roadmap": {},
        "documents": [],
        "brainstorm_notes": [],
        "equity_split": {},
        "decisions": [],
        "created_at": get_utc_now(),
        "updated_at": get_utc_now()
    }

    await deal_rooms_collection.insert_one(room_data)

    # Spinning up a deal room is the moment a match becomes a company attempt —
    # credit both founders.
    await gamification.award_many(room_data["participants"], "startups_created")

    room_data.pop("_id", None)
    return await _with_participants(room_data)

@router.get("/deal-rooms/{room_id}")
async def get_deal_room(
    room_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get deal room details"""
    room = await require_room_participant(room_id, current_user["user_id"])
    return await _with_participants(room)

@router.post("/deal-rooms/{room_id}/generate-roadmap", dependencies=[Depends(ai_rate_limit)])
async def generate_roadmap(
    room_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Generate AI roadmap for deal room"""
    room = await require_room_participant(room_id, current_user["user_id"])

    # Get participants' skills
    participants = await users_collection.find(
        {"user_id": {"$in": room["participants"]}},
        {"_id": 0, "profile.skills": 1}
    ).to_list(None)

    all_skills = []
    for p in participants:
        all_skills.extend(p.get("profile", {}).get("skills", []))

    # Generate roadmap
    roadmap = await ai_service.generate_roadmap(
        project_name=room["project_name"],
        vision=room["vision"],
        participants_skills=all_skills,
        duration_days=90
    )

    if not roadmap.get("phases"):
        # Don't overwrite a previously generated roadmap with an empty one
        raise HTTPException(
            status_code=503,
            detail="Roadmap generation is temporarily unavailable. Please try again shortly."
        )

    await _touch(room_id, roadmap=roadmap)

    return roadmap

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    assigned_to: Optional[str] = None

@router.post("/deal-rooms/{room_id}/tasks")
async def add_task(
    room_id: str,
    task: TaskCreate,
    current_user: dict = Depends(get_current_user)
):
    """Add a task to a deal room"""
    room = await require_room_participant(room_id, current_user["user_id"])

    # A task can only be assigned to one of the two founders.
    assignee = task.assigned_to or current_user["user_id"]
    if assignee not in room["participants"]:
        raise HTTPException(status_code=400, detail="Tasks can only be assigned to a participant")

    task_dict = {
        "task_id": f"task_{get_utc_now().timestamp()}",
        "title": task.title,
        "description": task.description or "",
        "assigned_to": assignee,
        "completed": False,
        "created_at": get_utc_now(),
    }

    await deal_rooms_collection.update_one(
        {"room_id": room_id},
        {"$push": {"tasks": task_dict}, "$set": {"updated_at": get_utc_now()}}
    )
    return task_dict

@router.patch("/deal-rooms/{room_id}/tasks/{task_id}")
async def toggle_task(
    room_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Toggle task completion"""
    room = await require_room_participant(room_id, current_user["user_id"])

    tasks = room.get("tasks", [])
    if not any(t.get("task_id") == task_id for t in tasks):
        raise HTTPException(status_code=404, detail="Task not found")

    for t in tasks:
        if t["task_id"] == task_id:
            t["completed"] = not t.get("completed", False)

    await _touch(room_id, tasks=tasks)
    return {"tasks": tasks}


# ===== Documents =====

class DocumentCreate(BaseModel):
    """
    A document is either a link or an uploaded file — exactly one of the two.

    Links stay supported because founders genuinely do keep their deck in Drive,
    and a link is always current where a copy goes stale. Uploads exist for what
    a link cannot carry: the signed agreement itself, which belongs with the room
    rather than in someone's personal Drive.
    """
    title: str = Field(min_length=1, max_length=200)
    url: Optional[str] = Field(default=None, max_length=2000)
    # Returned by /documents/upload-url once the file has been sent to storage.
    storage_key: Optional[str] = Field(default=None, max_length=500)
    filename: Optional[str] = Field(default=None, max_length=255)
    size_bytes: Optional[int] = Field(default=None, ge=0)
    doc_type: str = "other"
    note: Optional[str] = Field(default="", max_length=1000)


class DocumentUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = "application/octet-stream"


@router.post("/deal-rooms/{room_id}/documents/upload-url")
async def create_document_upload(
    room_id: str,
    payload: DocumentUploadRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Authorise one document upload and return where to send it.

    The bytes go straight to storage; the API only decides whether this caller
    may write into this room. Nothing is recorded until the client comes back to
    POST /documents with the returned key, so an abandoned upload leaves an
    orphaned object rather than a broken entry in the room.
    """
    await require_room_participant(room_id, current_user["user_id"])

    if not storage.configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "File uploads are not available on this server; attach a link "
                "instead. Missing: " + ", ".join(storage.missing_settings())
            ),
        )

    try:
        return storage.presign_document_upload(
            room_id, payload.filename, payload.content_type
        )
    except storage.StorageError as exc:
        status = 400 if "not accepted" in str(exc) else 502
        raise HTTPException(status_code=status, detail=str(exc))


@router.post("/deal-rooms/{room_id}/documents")
async def add_document(
    room_id: str,
    document: DocumentCreate,
    current_user: dict = Depends(get_current_user),
):
    """Attach a document to the room, by link or by uploaded file."""
    await require_room_participant(room_id, current_user["user_id"])

    has_link = bool(document.url and document.url.strip())
    has_file = bool(document.storage_key and document.storage_key.strip())

    if has_link == has_file:
        raise HTTPException(
            status_code=400,
            detail="Provide either a link or an uploaded file, not both",
        )

    entry: Dict[str, Any] = {
        "document_id": f"doc_{get_utc_now().timestamp()}",
        "title": document.title.strip(),
        "doc_type": document.doc_type if document.doc_type in DOCUMENT_TYPES else "other",
        "note": (document.note or "").strip(),
        "added_by": current_user["user_id"],
        "created_at": get_utc_now(),
    }

    if has_link:
        parsed = urlparse(document.url.strip())
        # http(s) only: a `javascript:` or `data:` URL in a shared workspace is a
        # link one founder can use to attack the other's session.
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise HTTPException(status_code=400, detail="Enter a full http(s) link")
        entry["kind"] = "link"
        entry["url"] = document.url.strip()
    else:
        key = document.storage_key.strip()
        # The key must be one we minted for *this* room. Without this check a
        # participant could attach any object in the bucket — including another
        # room's agreement — by guessing or replaying a key.
        if not key.startswith(f"rooms/{room_id}/"):
            raise HTTPException(status_code=400, detail="Unknown upload reference")
        entry["kind"] = "file"
        entry["storage_key"] = key
        entry["filename"] = (document.filename or document.title).strip()
        entry["size_bytes"] = document.size_bytes

    await deal_rooms_collection.update_one(
        {"room_id": room_id},
        {"$push": {"documents": entry}, "$set": {"updated_at": get_utc_now()}},
    )
    return entry


@router.get("/deal-rooms/{room_id}/documents/{document_id}/download")
async def download_document(
    room_id: str,
    document_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    A short-lived URL for reading one uploaded document.

    Deliberately not a public link. Room documents are the agreements a pair is
    negotiating, so every read is authorised against the room's membership first
    and the URL expires — even where the bucket itself happens to be readable.
    """
    room = await require_room_participant(room_id, current_user["user_id"])

    target = next(
        (d for d in room.get("documents", []) if d.get("document_id") == document_id),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Document not found")

    if target.get("kind") != "file" or not target.get("storage_key"):
        raise HTTPException(status_code=400, detail="This document is a link, open it directly")

    try:
        url = storage.presign_document_download(
            target["storage_key"], target.get("filename") or target.get("title") or "document"
        )
    except storage.StorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"url": url, "expires_in": storage.DOWNLOAD_URL_TTL, "filename": target.get("filename")}


@router.delete("/deal-rooms/{room_id}/documents/{document_id}")
async def remove_document(
    room_id: str,
    document_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Remove a document.

    Either founder can remove any of them: the room is a shared workspace, not
    two private ones, and a stale legal document is worse than a lost link.

    An uploaded file is deleted from storage too. Leaving the object behind
    would mean a document a founder believes they removed is still readable by
    anyone holding an old signed URL.
    """
    room = await require_room_participant(room_id, current_user["user_id"])

    target = next(
        (d for d in room.get("documents", []) if d.get("document_id") == document_id),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Document not found")

    await deal_rooms_collection.update_one(
        {"room_id": room_id},
        {
            "$pull": {"documents": {"document_id": document_id}},
            "$set": {"updated_at": get_utc_now()},
        },
    )

    if target.get("kind") == "file" and target.get("storage_key"):
        storage.delete_document(target["storage_key"])

    return {"document_id": document_id, "removed": True}


# ===== Decisions =====

class DecisionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    detail: Optional[str] = Field(default="", max_length=4000)


def _agreement_status(agreed_by: List[str], participants: List[str]) -> str:
    return "agreed" if set(participants).issubset(set(agreed_by)) else "proposed"


@router.post("/deal-rooms/{room_id}/decisions")
async def add_decision(
    room_id: str,
    decision: DecisionCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Record a decision. The author counts as having agreed to it; it stays
    `proposed` until the other founder confirms.
    """
    room = await require_room_participant(room_id, current_user["user_id"])
    user_id = current_user["user_id"]

    entry = {
        "decision_id": f"decision_{get_utc_now().timestamp()}",
        "title": decision.title.strip(),
        "detail": (decision.detail or "").strip(),
        "created_by": user_id,
        "created_at": get_utc_now(),
        "agreed_by": [user_id],
        "status": _agreement_status([user_id], room["participants"]),
    }

    await deal_rooms_collection.update_one(
        {"room_id": room_id},
        {"$push": {"decisions": entry}, "$set": {"updated_at": get_utc_now()}},
    )
    return entry


@router.post("/deal-rooms/{room_id}/decisions/{decision_id}/agree")
async def agree_to_decision(
    room_id: str,
    decision_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Sign off on a decision. Idempotent — agreeing twice changes nothing."""
    room = await require_room_participant(room_id, current_user["user_id"])
    user_id = current_user["user_id"]

    decisions = room.get("decisions", [])
    target = next((d for d in decisions if d.get("decision_id") == decision_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Decision not found")

    agreed = list(target.get("agreed_by") or [])
    if user_id not in agreed:
        agreed.append(user_id)
    target["agreed_by"] = agreed
    target["status"] = _agreement_status(agreed, room["participants"])

    await _touch(room_id, decisions=decisions)
    return target


# ===== Equity =====

class EquityProposal(BaseModel):
    """
    A proposed split, keyed by user id, in percent.

    Vesting is captured because a split without it is the founder mistake this tab
    exists to prevent: an equal split that vests over four years with a one-year
    cliff is a different agreement from an equal split handed over on day one.
    """
    splits: Dict[str, float]
    vesting_months: int = Field(default=48, ge=0, le=120)
    cliff_months: int = Field(default=12, ge=0, le=60)
    notes: Optional[str] = Field(default="", max_length=2000)


@router.put("/deal-rooms/{room_id}/equity")
async def propose_equity(
    room_id: str,
    proposal: EquityProposal,
    current_user: dict = Depends(get_current_user),
):
    """
    Propose an equity split, replacing any previous proposal.

    A new proposal resets agreement to the proposer alone — otherwise one founder
    could edit the numbers under a split the other had already accepted.
    """
    room = await require_room_participant(room_id, current_user["user_id"])
    user_id = current_user["user_id"]
    participants = room["participants"]

    if set(proposal.splits) != set(participants):
        raise HTTPException(
            status_code=400,
            detail="The split must name exactly the room's participants",
        )

    if any(not 0 <= share <= 100 for share in proposal.splits.values()):
        raise HTTPException(status_code=400, detail="Each share must be between 0 and 100")

    total = sum(proposal.splits.values())
    if abs(total - 100) > EQUITY_TOLERANCE:
        raise HTTPException(
            status_code=400,
            detail=f"Shares must add up to 100% (currently {round(total, 2)}%)",
        )

    equity = {
        "splits": {uid: round(share, 2) for uid, share in proposal.splits.items()},
        "vesting_months": proposal.vesting_months,
        "cliff_months": proposal.cliff_months,
        "notes": (proposal.notes or "").strip(),
        "proposed_by": user_id,
        "proposed_at": get_utc_now(),
        "agreed_by": [user_id],
        "status": _agreement_status([user_id], participants),
    }

    await _touch(room_id, equity_split=equity)
    return equity


@router.post("/deal-rooms/{room_id}/equity/accept")
async def accept_equity(
    room_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Accept the standing equity proposal."""
    room = await require_room_participant(room_id, current_user["user_id"])
    user_id = current_user["user_id"]

    equity = room.get("equity_split") or {}
    if not equity.get("splits"):
        raise HTTPException(status_code=404, detail="No equity split has been proposed yet")

    agreed = list(equity.get("agreed_by") or [])
    if user_id not in agreed:
        agreed.append(user_id)
    equity["agreed_by"] = agreed
    equity["status"] = _agreement_status(agreed, room["participants"])
    if equity["status"] == "agreed":
        equity.setdefault("agreed_at", get_utc_now())

    await _touch(room_id, equity_split=equity)
    return equity


@router.get("/matches/{match_id}/deal-room")
async def get_or_create_deal_room(
    match_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get the deal room for a match, or return null if it doesn't exist"""
    room = await deal_rooms_collection.find_one({"match_id": match_id}, {"_id": 0})
    if not room:
        return {"room": None}
    if current_user["user_id"] not in room["participants"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    return {"room": await _with_participants(room)}
