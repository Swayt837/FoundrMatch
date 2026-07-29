"""
CoFound Backend API
A comprehensive platform for matching business cofounders
"""
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import socketio
import os
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from dotenv import load_dotenv
from pydantic import BaseModel

# Import models and utilities
from models import (
    UserRegistration, UserLogin, OnboardingData, SwipeAction,
    MessageCreate, ProjectCreate, DealRoomCreate, DealRoomTask,
    AIBusinessRequest, CompatibilityScore
)
from database import (
    users_collection, swipes_collection, matches_collection,
    messages_collection, deal_rooms_collection, projects_collection,
    user_sessions_collection, create_indexes, generate_user_id,
    get_utc_now
)
from auth import (
    get_password_hash, verify_password, create_access_token,
    get_current_user, process_google_session, 
    create_or_get_user_from_google, store_session
)
from ai_service import ai_service, TextDelta, StreamDone

load_dotenv()


# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await create_indexes()
    print("✅ Database indexes created")
    yield
    # Shutdown
    print("Shutting down...")


app = FastAPI(title="CoFound API", lifespan=lifespan)

# Socket.io setup for real-time chat
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=True,
    engineio_logger=False
)
socket_app = socketio.ASGIApp(sio, app)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===== AUTHENTICATION ROUTES =====

@app.post("/api/auth/register")
async def register(user_data: UserRegistration):
    """Register new user with email and password"""
    # Check if user exists
    existing_user = await users_collection.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    user_id = await generate_user_id()
    hashed_password = get_password_hash(user_data.password)
    
    new_user = {
        "user_id": user_id,
        "email": user_data.email,
        "password_hash": hashed_password,
        "profile": {
            "name": user_data.name,
            "photos": [],
            "country": "",
            "city": "",
            "languages": [],
            "age": None,
            "bio": None,
            "profession": None,
            "skills": [],
            "experience": None,
            "availability": None,
            "budget": "",
            "objectives": [],
            "personality": None,
            "work_style": [],
            "values": []
        },
        "verification": {
            "email_verified": False,
            "linkedin_verified": False,
            "github_verified": False,
            "portfolio_verified": False,
            "identity_verified": False
        },
        "gamification": {
            "level": 1,
            "projects_count": 0,
            "startups_created": 0,
            "recommendations_count": 0,
            "badges": []
        },
        "settings": {
            "notifications_enabled": True,
            "distance_preference": 100,
            "show_age": True,
            "premium": False
        },
        "onboarding_completed": False,
        "created_at": get_utc_now(),
        "updated_at": get_utc_now(),
        "last_active": get_utc_now()
    }
    
    await users_collection.insert_one(new_user)
    
    # Create access token
    access_token = create_access_token({"user_id": user_id})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user_id,
        "onboarding_completed": False
    }


@app.post("/api/auth/login")
async def login(credentials: UserLogin):
    """Login with email and password"""
    user = await users_collection.find_one({"email": credentials.email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not user.get("password_hash"):
        raise HTTPException(
            status_code=401,
            detail="Please login with Google (no password set)"
        )
    
    if not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Create access token
    access_token = create_access_token({"user_id": user["user_id"]})
    
    # Update last active
    await users_collection.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"last_active": get_utc_now()}}
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user["user_id"],
        "onboarding_completed": user.get("onboarding_completed", False)
    }


@app.post("/api/auth/google/callback")
async def google_callback(session_id: str):
    """Handle Google OAuth callback"""
    # Get session data from Emergent auth
    session_data = await process_google_session(session_id)
    
    # Create or get user
    user = await create_or_get_user_from_google(
        google_id=session_data["id"],
        email=session_data["email"],
        name=session_data["name"],
        picture=session_data.get("picture", "")
    )
    
    # Store session
    await store_session(session_data["session_token"], user["user_id"])
    
    return {
        "session_token": session_data["session_token"],
        "user_id": user["user_id"],
        "onboarding_completed": user.get("onboarding_completed", False)
    }


@app.get("/api/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Get current user profile"""
    return current_user


@app.post("/api/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Logout user"""
    if not authorization:
        return {"message": "Already logged out"}
    
    parts = authorization.split()
    if len(parts) == 2:
        token = parts[1]
        # Delete session
        await user_sessions_collection.delete_one({"session_token": token})
    
    return {"message": "Logged out successfully"}


# ===== ONBOARDING ROUTES =====

@app.post("/api/onboarding/complete")
async def complete_onboarding(
    data: OnboardingData,
    current_user: dict = Depends(get_current_user)
):
    """Complete user onboarding"""
    update_data = {
        "profile.country": data.country,
        "profile.city": data.city,
        "profile.languages": data.languages,
        "profile.age": data.age,
        "profile.profession": data.profession,
        "profile.skills": data.skills,
        "profile.experience": data.experience,
        "profile.availability": data.availability,
        "profile.budget": data.budget,
        "profile.objectives": data.objectives,
        "profile.work_style": data.work_style,
        "profile.values": data.values,
        "profile.bio": data.bio,
        "onboarding_completed": True,
        "updated_at": get_utc_now()
    }
    
    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": update_data}
    )
    
    return {"message": "Onboarding completed", "onboarding_completed": True}


@app.post("/api/profile/photos")
async def upload_photos(
    photos: List[str],
    current_user: dict = Depends(get_current_user)
):
    """Upload profile photos (base64 encoded, max 5)"""
    if len(photos) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 photos allowed")
    
    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"profile.photos": photos, "updated_at": get_utc_now()}}
    )
    
    return {"message": "Photos uploaded", "count": len(photos)}


@app.get("/api/profile/{user_id}")
async def get_profile(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get another user's profile"""
    user = await users_collection.find_one(
        {"user_id": user_id},
        {"_id": 0, "password_hash": 0, "google_id": 0}
    )
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user


@app.post("/api/profile/update")
async def update_profile(
    updates: Dict[str, Any],
    current_user: dict = Depends(get_current_user)
):
    """Partial update of the current user's profile fields"""
    # Whitelist allowed profile fields for security
    allowed = {
        "name", "bio", "country", "city", "languages", "age",
        "profession", "skills", "experience", "availability",
        "budget", "objectives", "work_style", "values", "photos"
    }
    
    set_ops = {"updated_at": get_utc_now()}
    for key, value in updates.items():
        if key in allowed:
            set_ops[f"profile.{key}"] = value
    
    if len(set_ops) == 1:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    
    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": set_ops}
    )
    
    # Invalidate compat cache for this user
    from database import db as mongo_db
    await mongo_db.compatibility_cache.delete_many(
        {"pair_key": {"$regex": current_user["user_id"]}}
    )
    
    updated = await users_collection.find_one(
        {"user_id": current_user["user_id"]},
        {"_id": 0, "password_hash": 0, "google_id": 0}
    )
    return updated


# ===== DISCOVERY & MATCHING ROUTES =====

@app.get("/api/discovery/cards")
async def get_discovery_cards(
    limit: int = 10,
    current_user: dict = Depends(get_current_user)
):
    """Get cards for swiping - with parallel AI + cache"""
    import asyncio
    from database import db as mongo_db
    
    compat_cache = mongo_db.compatibility_cache
    user_id = current_user["user_id"]
    
    # Get users already swiped on
    swiped = await swipes_collection.find(
        {"user_id": user_id}
    ).to_list(None)
    swiped_ids = [s["target_user_id"] for s in swiped]
    
    # Get potential matches (exclude self and already swiped)
    exclude_ids = swiped_ids + [user_id]
    
    candidates = await users_collection.find(
        {
            "user_id": {"$nin": exclude_ids},
            "onboarding_completed": True
        },
        {"_id": 0, "password_hash": 0, "google_id": 0}
    ).limit(limit).to_list(limit)
    
    if not candidates:
        return {"cards": []}
    
    # Compute compatibility with parallelism + caching
    async def compute_or_cache(candidate):
        pair_key = "-".join(sorted([user_id, candidate["user_id"]]))
        # Check cache first
        cached = await compat_cache.find_one({"pair_key": pair_key}, {"_id": 0})
        if cached and cached.get("compatibility"):
            return {"user": candidate, "compatibility": cached["compatibility"]}
        
        try:
            compatibility = await ai_service.calculate_compatibility(current_user, candidate)
            # Store in cache
            await compat_cache.update_one(
                {"pair_key": pair_key},
                {"$set": {"pair_key": pair_key, "compatibility": compatibility, "created_at": get_utc_now()}},
                upsert=True
            )
            return {"user": candidate, "compatibility": compatibility}
        except Exception as e:
            print(f"Error computing compatibility: {e}")
            return None
    
    # Run all AI calls concurrently
    results = await asyncio.gather(*[compute_or_cache(c) for c in candidates])
    cards = [r for r in results if r is not None]
    
    # Sort by compatibility score
    cards.sort(key=lambda x: x["compatibility"]["overall_score"], reverse=True)
    
    return {"cards": cards}


@app.post("/api/swipe")
async def swipe(
    action: SwipeAction,
    current_user: dict = Depends(get_current_user)
):
    """Swipe on a user"""
    user_id = current_user["user_id"]
    target_id = action.target_user_id
    
    # Check if already swiped
    existing = await swipes_collection.find_one({
        "user_id": user_id,
        "target_user_id": target_id
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="Already swiped on this user")
    
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
            # It's a match!
            target_user = await users_collection.find_one(
                {"user_id": target_id},
                {"_id": 0, "password_hash": 0}
            )
            
            # Calculate compatibility
            compatibility = await ai_service.calculate_compatibility(
                current_user,
                target_user
            )
            
            # Create match
            match_data = {
                "match_id": f"match_{user_id[:6]}_{target_id[:6]}_{get_utc_now().timestamp()}",
                "user1_id": user_id,
                "user2_id": target_id,
                "compatibility_score": compatibility,
                "status": "matched",
                "created_at": get_utc_now()
            }
            await matches_collection.insert_one(match_data)
            
            return {
                "matched": True,
                "match_id": match_data["match_id"],
                "user": target_user,
                "compatibility": compatibility
            }
    
    return {"matched": False}


@app.get("/api/matches")
async def get_matches(
    current_user: dict = Depends(get_current_user)
):
    """Get user's matches"""
    user_id = current_user["user_id"]
    
    matches = await matches_collection.find({
        "$or": [
            {"user1_id": user_id},
            {"user2_id": user_id}
        ]
    }, {"_id": 0}).sort("created_at", -1).to_list(None)
    
    # Populate match user data
    result = []
    for match in matches:
        other_id = match["user2_id"] if match["user1_id"] == user_id else match["user1_id"]
        other_user = await users_collection.find_one(
            {"user_id": other_id},
            {"_id": 0, "password_hash": 0, "google_id": 0}
        )
        
        if other_user:
            result.append({
                "match_id": match["match_id"],
                "user": other_user,
                "compatibility": match.get("compatibility_score"),
                "created_at": match["created_at"]
            })
    
    return {"matches": result}


# ===== CHAT ROUTES =====

@app.get("/api/chat/{match_id}/messages")
async def get_messages(
    match_id: str,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get messages for a match"""
    # Verify user is part of match
    match = await matches_collection.find_one({"match_id": match_id})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    
    user_id = current_user["user_id"]
    if user_id not in [match["user1_id"], match["user2_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    messages = await messages_collection.find(
        {"match_id": match_id},
        {"_id": 0}
    ).sort("created_at", 1).limit(limit).to_list(limit)
    
    return {"messages": messages}


@app.post("/api/chat/{match_id}/send")
async def send_message(
    match_id: str,
    message: MessageCreate,
    current_user: dict = Depends(get_current_user)
):
    """Send a message"""
    # Verify match
    match = await matches_collection.find_one({"match_id": match_id})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    
    user_id = current_user["user_id"]
    if user_id not in [match["user1_id"], match["user2_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Create message
    msg_data = {
        "message_id": f"msg_{get_utc_now().timestamp()}",
        "match_id": match_id,
        "sender_id": user_id,
        "content": message.content,
        "type": message.type,
        "read": False,
        "created_at": get_utc_now()
    }
    await messages_collection.insert_one(msg_data)
    
    # Emit via Socket.io
    await sio.emit("new_message", msg_data, room=match_id)
    
    msg_data.pop("_id", None)
    return msg_data


# ===== DEAL ROOMS ROUTES =====

@app.post("/api/deal-rooms/create")
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
    
    room_data.pop("_id", None)
    return room_data


@app.get("/api/deal-rooms/{room_id}")
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


@app.post("/api/deal-rooms/{room_id}/generate-roadmap")
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


@app.post("/api/deal-rooms/{room_id}/tasks")
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


@app.patch("/api/deal-rooms/{room_id}/tasks/{task_id}")
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


@app.get("/api/matches/{match_id}/deal-room")
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


# ===== PROJECTS ROUTES =====

@app.post("/api/projects/create")
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
    
    return project_data


@app.get("/api/projects")
async def get_projects(
    status: str = "open",
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Get project listings"""
    projects = await projects_collection.find(
        {"status": status},
        {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    
    return {"projects": projects}


# ===== AI ASSISTANT ROUTES =====

@app.get("/api/ai/business-ideas/{match_id}")
async def get_business_ideas(
    match_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Generate business ideas for a match"""
    match = await matches_collection.find_one({"match_id": match_id})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    
    user_id = current_user["user_id"]
    if user_id not in [match["user1_id"], match["user2_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
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
    
    return {"ideas": ideas}


# ===== AI COPILOT CHAT =====


class AICopilotRequest(BaseModel):
    message: str
    history: List[Dict[str, str]] = []


@app.post("/api/ai/copilot/chat")
async def copilot_chat(
    payload: AICopilotRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    General AI copilot chat - non-streaming for simplicity.
    Uses user's profile as context.
    """
    from ai_service import LlmChat, UserMessage
    
    profile = current_user.get("profile", {})
    profession = profile.get("profession", "founder")
    skills = ", ".join(profile.get("skills", [])[:5]) or "not specified"
    objectives = ", ".join(profile.get("objectives", [])[:3]) or "not specified"
    experience = profile.get("experience", "not specified")
    
    system_message = f"""You are CoFound AI Copilot, an expert startup advisor helping entrepreneurs build their business.

User context:
- Profession: {profession}
- Skills: {skills}
- Experience: {experience}
- Objectives: {objectives}

Provide concise, actionable advice. Use markdown when helpful. Ask clarifying questions when needed. 
Keep responses focused and under 200 words unless the user asks for depth."""
    
    session_id = f"copilot-{current_user['user_id']}"
    
    try:
        chat = LlmChat(
            api_key=os.getenv("EMERGENT_LLM_KEY"),
            session_id=session_id,
            system_message=system_message
        ).with_model("anthropic", "claude-sonnet-4-6")
        
        user_msg = UserMessage(text=payload.message)
        
        response_text = ""
        async for event in chat.stream_message(user_msg):
            if isinstance(event, TextDelta):
                response_text += event.content
            elif isinstance(event, StreamDone):
                break
        
        return {"response": response_text}
    except Exception as e:
        print(f"AI Copilot error: {e}")
        raise HTTPException(status_code=500, detail=f"AI service error: {str(e)}")


# ===== HEALTH CHECK =====

@app.get("/api/health")
async def health():
    return {"status": "healthy", "service": "CoFound API"}


@app.get("/api")
async def root():
    return {"message": "CoFound API - Find your perfect business partner"}


# ===== SOCKET.IO EVENTS =====

@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")


@sio.event
async def disconnect(sid):
    print(f"Client disconnected: {sid}")


@sio.event
async def join_match(sid, data):
    """Join a match room for real-time chat"""
    match_id = data.get("match_id")
    if match_id:
        sio.enter_room(sid, match_id)
        await sio.emit("joined", {"match_id": match_id}, room=sid)


@sio.event
async def leave_match(sid, data):
    """Leave a match room"""
    match_id = data.get("match_id")
    if match_id:
        sio.leave_room(sid, match_id)


@sio.event
async def typing(sid, data):
    """User is typing"""
    match_id = data.get("match_id")
    user_id = data.get("user_id")
    if match_id:
        await sio.emit("user_typing", {"user_id": user_id}, room=match_id, skip_sid=sid)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:socket_app", host="0.0.0.0", port=8001, reload=True)
