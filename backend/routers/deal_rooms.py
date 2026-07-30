"""
Deal rooms: the shared workspace a matched pair uses to start building.

Creating one is a Premium feature, per the PRD.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ai_service import ai_service
from auth import get_current_user
from database import deal_rooms_collection, get_utc_now, matches_collection, users_collection
from deps import ai_rate_limit
from models import DealRoomCreate
from premium import require_premium
import gamification

router = APIRouter(prefix="/api", tags=["deal-rooms"])


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
    return room_data

@router.get("/deal-rooms/{room_id}")
async def get_deal_room(
    room_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get deal room details"""
    room = await deal_rooms_collection.find_one({"room_id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Deal room not found")
    
    if current_user["user_id"] not in room["participants"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    return room

@router.post("/deal-rooms/{room_id}/generate-roadmap", dependencies=[Depends(ai_rate_limit)])
async def generate_roadmap(
    room_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Generate AI roadmap for deal room"""
    room = await deal_rooms_collection.find_one({"room_id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Deal room not found")
    
    if current_user["user_id"] not in room["participants"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
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

    # Update room
    await deal_rooms_collection.update_one(
        {"room_id": room_id},
        {"$set": {"roadmap": roadmap, "updated_at": get_utc_now()}}
    )

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
    room = await deal_rooms_collection.find_one({"room_id": room_id})
    if not room:
        raise HTTPException(status_code=404, detail="Deal room not found")
    if current_user["user_id"] not in room["participants"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    task_dict = {
        "task_id": f"task_{get_utc_now().timestamp()}",
        "title": task.title,
        "description": task.description or "",
        "assigned_to": task.assigned_to or current_user["user_id"],
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
    room = await deal_rooms_collection.find_one({"room_id": room_id})
    if not room:
        raise HTTPException(status_code=404, detail="Deal room not found")
    if current_user["user_id"] not in room["participants"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    tasks = room.get("tasks", [])
    for t in tasks:
        if t["task_id"] == task_id:
            t["completed"] = not t.get("completed", False)
    
    await deal_rooms_collection.update_one(
        {"room_id": room_id},
        {"$set": {"tasks": tasks, "updated_at": get_utc_now()}}
    )
    return {"tasks": tasks}

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
    return {"room": room}
