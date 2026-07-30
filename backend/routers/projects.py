"""
Projects: cofounder opportunity postings and applications.
"""
import re
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from auth import get_current_user
from database import get_utc_now, projects_collection, users_collection
from models import ProjectApplication, ProjectCreate
from moderation import assert_not_blocked, blocked_user_ids
from realtime import sio
from serializers import PUBLIC_USER_PROJECTION, public_user
import gamification

router = APIRouter(prefix="/api", tags=["projects"])


@router.post("/projects/create")
async def create_project(
    data: ProjectCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a project posting"""
    project_data = {
        "project_id": f"proj_{get_utc_now().timestamp()}",
        "user_id": current_user["user_id"],
        "title": data.title,
        "description": data.description,
        "looking_for": data.looking_for,
        "hours_per_week": data.hours_per_week,
        "equity_percentage": data.equity_percentage,
        "skills_needed": data.skills_needed,
        "status": "open",
        "applicants": [],
        "created_at": get_utc_now()
    }
    
    await projects_collection.insert_one(project_data)
    project_data.pop("_id", None)

    await gamification.award(current_user["user_id"], "projects_count")

    return project_data

@router.get("/projects")
async def get_projects(
    status: str = "open",
    limit: int = 20,
    looking_for: Optional[str] = None,
    skill: Optional[str] = None,
    min_hours: Optional[int] = None,
    max_hours: Optional[int] = None,
    min_equity: Optional[float] = None,
    max_equity: Optional[float] = None,
    my_city_only: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """Get project listings with optional filters."""
    query: Dict[str, Any] = {"status": status}
    if looking_for:
        query["looking_for"] = looking_for
    if skill:
        # Case-insensitive exact skill match, escaped so a value like `(a+)+$`
        # cannot turn into a catastrophic-backtracking regex.
        query["skills_needed"] = {"$regex": f"^{re.escape(skill)}$", "$options": "i"}
    hours_query = {}
    if min_hours is not None:
        hours_query["$gte"] = min_hours
    if max_hours is not None:
        hours_query["$lte"] = max_hours
    if hours_query:
        query["hours_per_week"] = hours_query
    equity_query = {}
    if min_equity is not None:
        equity_query["$gte"] = min_equity
    if max_equity is not None:
        equity_query["$lte"] = max_equity
    if equity_query:
        query["equity_percentage"] = equity_query
    
    # my-city-only filter: only projects from users in my city
    if my_city_only:
        my_city = (current_user.get("profile") or {}).get("city")
        if my_city:
            # Find user_ids in same city
            same_city_users = await users_collection.find(
                {"profile.city": {"$regex": f"^{re.escape(my_city)}$", "$options": "i"}},
                {"user_id": 1, "_id": 0}
            ).to_list(1000)
            city_user_ids = [u["user_id"] for u in same_city_users]
            query["user_id"] = {"$in": city_user_ids}

    # Hide postings from users blocked in either direction
    hidden = await blocked_user_ids(current_user["user_id"])
    if hidden:
        existing_user_filter = query.get("user_id")
        if isinstance(existing_user_filter, dict) and "$in" in existing_user_filter:
            query["user_id"] = {
                "$in": [uid for uid in existing_user_filter["$in"] if uid not in hidden]
            }
        else:
            query["user_id"] = {"$nin": list(hidden)}

    projects = await projects_collection.find(
        query,
        {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)

    return {"projects": [_project_summary(p, current_user["user_id"]) for p in projects]}

@router.get("/projects/mine")
async def get_my_projects(current_user: dict = Depends(get_current_user)):
    """
    The current user's own postings, with applicant counts.

    Declared before `/api/projects/{project_id}` so the literal path wins over the
    parameterised one.
    """
    projects = await projects_collection.find(
        {"user_id": current_user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(None)

    return {"projects": [_project_summary(p, current_user["user_id"]) for p in projects]}

@router.get("/projects/{project_id}")
async def get_project(
    project_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Project detail, including the poster's public profile."""
    project = await projects_collection.find_one({"project_id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await assert_not_blocked(current_user["user_id"], project["user_id"])

    owner = await users_collection.find_one(
        {"user_id": project["user_id"]}, PUBLIC_USER_PROJECTION
    )

    return {
        **_project_summary(project, current_user["user_id"]),
        "owner": public_user(owner),
    }

@router.post("/projects/{project_id}/apply")
async def apply_to_project(
    project_id: str,
    application: ProjectApplication,
    current_user: dict = Depends(get_current_user)
):
    """
    Apply to a cofounder opportunity.

    The `applicants` array has existed on every project document since the first
    version but nothing ever wrote to it — there was no way to answer a posting.
    """
    project = await projects_collection.find_one({"project_id": project_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    user_id = current_user["user_id"]
    if project["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="You cannot apply to your own project")

    await assert_not_blocked(user_id, project["user_id"])

    if project.get("status") != "open":
        raise HTTPException(status_code=400, detail="This opportunity is closed")

    if any(a.get("user_id") == user_id for a in project.get("applicants") or []):
        raise HTTPException(status_code=400, detail="You already applied to this project")

    applicant = {
        "user_id": user_id,
        "message": application.message.strip(),
        "status": "pending",
        "created_at": get_utc_now(),
    }

    await projects_collection.update_one(
        {"project_id": project_id},
        {"$push": {"applicants": applicant}, "$set": {"updated_at": get_utc_now()}}
    )

    await sio.emit("project_application", {
        "project_id": project_id,
        "project_title": project.get("title"),
    }, room=f"user:{project['user_id']}")

    return {"applied": True, "project_id": project_id}

@router.get("/projects/{project_id}/applicants")
async def get_project_applicants(
    project_id: str,
    current_user: dict = Depends(get_current_user)
):
    """List applicants with their public profiles. Owner only."""
    project = await projects_collection.find_one({"project_id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    applicants = project.get("applicants") or []
    if not applicants:
        return {"applicants": []}

    users = await users_collection.find(
        {"user_id": {"$in": [a["user_id"] for a in applicants]}}, PUBLIC_USER_PROJECTION
    ).to_list(None)
    users_by_id = {u["user_id"]: public_user(u) for u in users}

    return {
        "applicants": [
            {**a, "user": users_by_id.get(a["user_id"])}
            for a in applicants
            if users_by_id.get(a["user_id"])
        ]
    }

@router.patch("/projects/{project_id}/status")
async def update_project_status(
    project_id: str,
    status: str = Body(..., embed=True),
    current_user: dict = Depends(get_current_user)
):
    """Open or close a posting. Owner only."""
    if status not in ("open", "closed"):
        raise HTTPException(status_code=400, detail="Status must be 'open' or 'closed'")

    project = await projects_collection.find_one({"project_id": project_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    await projects_collection.update_one(
        {"project_id": project_id},
        {"$set": {"status": status, "updated_at": get_utc_now()}}
    )
    return {"project_id": project_id, "status": status}

def _project_summary(project: Dict[str, Any], viewer_id: str) -> Dict[str, Any]:
    """
    Shape a project for a listing.

    The raw `applicants` array names everyone who applied, so it is replaced by a
    count plus a flag for the viewer — only the owner gets the full list, via
    `/api/projects/{id}/applicants`.
    """
    applicants = project.get("applicants") or []
    summary = {k: v for k, v in project.items() if k != "applicants"}
    summary["applicants_count"] = len(applicants)
    summary["has_applied"] = any(a.get("user_id") == viewer_id for a in applicants)
    summary["is_owner"] = project.get("user_id") == viewer_id
    return summary
