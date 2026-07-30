"""
CoFound Backend API
A comprehensive platform for matching business cofounders
"""
from fastapi import FastAPI, HTTPException, Depends, Header, Body
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import re
import socketio
import os
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv
from pydantic import BaseModel, Field

# Import models and utilities
from models import (
    UserRegistration, UserLogin, OnboardingData, SwipeAction,
    MessageCreate, ProjectCreate, DealRoomCreate,
    PhotosUpload, ProjectApplication
)
from database import (
    users_collection, swipes_collection, matches_collection,
    messages_collection, deal_rooms_collection, projects_collection,
    user_sessions_collection, create_indexes,
    run_migrations, rescore_matches_for, generate_user_id, get_utc_now
)
from auth import (
    get_password_hash, verify_password, create_access_token,
    get_current_user, process_google_session,
    create_or_get_user_from_google, store_session,
    validate_password_strength
)
from ai_service import ai_service, TextDelta, StreamDone
from compatibility import dimension_breakdown, score_compatibility
from premium import router as premium_router, webhook_router as premium_webhook_router
from account import router as account_router
from moderation import blocked_user_ids, assert_not_blocked
from quotas import claim_daily_swipe
import gamification
from serializers import public_user, private_user, PUBLIC_USER_PROJECTION
from rate_limit import RateLimiter

# Auth endpoints are brute-force targets; the AI routes cost real tokens per call.
auth_rate_limit = RateLimiter("auth", limit=10, window=60)
ai_rate_limit = RateLimiter("ai", limit=20, window=60)

# How many candidates the discovery feed ranks per request. Scoring is local and
# costs microseconds per pair, so this is bounded by the Mongo read rather than by
# compute — it used to be `limit * 3` because every card cost an LLM call.
DISCOVERY_CANDIDATE_POOL = int(os.getenv("DISCOVERY_CANDIDATE_POOL", "500"))

load_dotenv()


# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await create_indexes()
    print("✅ Database indexes created")
    await run_migrations()
    yield
    # Shutdown
    print("Shutting down...")


app = FastAPI(title="CoFound API", lifespan=lifespan)

# Allowed origins come from the environment. `*` stays the default for local
# development, but it is incompatible with credentialed requests — browsers
# reject that combination — so credentials are only enabled for an explicit list.
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]
_allow_any_origin = "*" in ALLOWED_ORIGINS

# Socket.io setup for real-time chat
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*' if _allow_any_origin else ALLOWED_ORIGINS,
    logger=False,
    engineio_logger=False
)
socket_app = socketio.ASGIApp(sio, app)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=not _allow_any_origin,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Premium (Stripe) routes
app.include_router(premium_router)
app.include_router(premium_webhook_router)
# Settings, account deletion and moderation
app.include_router(account_router)


# ===== AUTHENTICATION ROUTES =====

@app.post("/api/auth/register", dependencies=[Depends(auth_rate_limit)])
async def register(user_data: UserRegistration):
    """Register new user with email and password"""
    # Enforce the password policy server-side — the client hint alone is not a rule
    validate_password_strength(user_data.password)

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
            "show_age": True
        },
        # Premium lives at the document root — `premium.py` reads and writes it
        # there. Keeping a second copy under `settings` guaranteed the two would
        # drift apart.
        "premium": False,
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


@app.post("/api/auth/login", dependencies=[Depends(auth_rate_limit)])
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


@app.post("/api/auth/google/callback", dependencies=[Depends(auth_rate_limit)])
async def google_callback(session_id: str = Body(..., embed=True)):
    """
    Handle Google OAuth callback.

    `session_id` must be declared as a Body field: a bare `str` parameter is read
    from the query string by FastAPI, so the JSON body the client sends was
    rejected with a 422 and Google sign-in never worked.
    """
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
    return private_user(current_user)


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
    payload: PhotosUpload,
    current_user: dict = Depends(get_current_user)
):
    """
    Upload profile photos (base64 encoded, max 5).

    Wrapped in a Pydantic model: a bare `List[str]` parameter is read from the
    query string by FastAPI, so the JSON array the client posts was rejected with
    a 422 and onboarding silently lost every photo. The model also caps the
    payload size — base64 images live inside the user document, which MongoDB
    limits to 16 MB.
    """
    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"profile.photos": payload.photos, "updated_at": get_utc_now()}}
    )

    return {"message": "Photos uploaded", "count": len(payload.photos)}


@app.get("/api/profile/{user_id}")
async def get_profile(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get another user's profile"""
    # Either side of a block hides the profile from the other
    await assert_not_blocked(current_user["user_id"], user_id)

    user = await users_collection.find_one(
        {"user_id": user_id},
        PUBLIC_USER_PROJECTION
    )

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return public_user(user)


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
    
    # Drop the cached AI narratives and reports for this user's pairs — they
    # describe the profile as it was. The id is escaped: user ids are generated by
    # us, but interpolating any value straight into $regex is how regex-injection
    # bugs get introduced later.
    from database import db as mongo_db
    await mongo_db.compatibility_cache.delete_many(
        {"pair_key": {"$regex": re.escape(current_user["user_id"])}}
    )

    # Existing matches store their score, so it has to be recomputed or the match
    # list keeps showing a score for the old profile. Free and local.
    await rescore_matches_for(current_user["user_id"])

    updated = await users_collection.find_one({"user_id": current_user["user_id"]})
    return private_user(updated)


# ===== DISCOVERY & MATCHING ROUTES =====

@app.get("/api/discovery/cards")
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


@app.post("/api/swipe")
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
            # It's a match!
            target_user = await users_collection.find_one(
                {"user_id": target_id},
                PUBLIC_USER_PROJECTION
            )

            # Score the pair. Deterministic and instant, so the match is created in
            # the same request instead of waiting on an LLM round trip.
            compatibility = score_compatibility(
                current_user.get("profile") or {},
                (target_user or {}).get("profile") or {},
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

            await gamification.award_many([user_id, target_id], "matches_count")

            # Notify the other side in real time if they have a socket open
            await sio.emit("new_match", {
                "match_id": match_data["match_id"],
                "user": public_user(current_user),
                "compatibility": compatibility,
            }, room=f"user:{target_id}")

            return {
                "matched": True,
                "match_id": match_data["match_id"],
                "user": public_user(target_user),
                "compatibility": compatibility,
                "swipes_used_today": swipes_today,
            }

    return {"matched": False, "swipes_used_today": swipes_today}


@app.get("/api/matches")
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


@app.delete("/api/matches/{match_id}")
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


# ===== CHAT ROUTES =====

async def require_match_participant(match_id: str, user_id: str) -> Dict[str, Any]:
    """Load a match, asserting the caller is one of its two participants."""
    match = await matches_collection.find_one({"match_id": match_id})
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    if user_id not in [match["user1_id"], match["user2_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")

    return match


@app.get("/api/chat/{match_id}/messages")
async def get_messages(
    match_id: str,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """
    Get messages for a match and mark the other side's messages as read.

    Opening the conversation is the read receipt — the `read` flag was written as
    False on every message and never updated, so unread counts were impossible.
    """
    user_id = current_user["user_id"]
    await require_match_participant(match_id, user_id)

    messages = await messages_collection.find(
        {"match_id": match_id},
        {"_id": 0}
    ).sort("created_at", 1).limit(limit).to_list(limit)

    result = await messages_collection.update_many(
        {"match_id": match_id, "sender_id": {"$ne": user_id}, "read": False},
        {"$set": {"read": True, "read_at": get_utc_now()}},
    )

    if result.modified_count:
        # Let the sender's open chat window flip its delivery ticks
        await sio.emit(
            "messages_read",
            {"match_id": match_id, "reader_id": user_id},
            room=match_id,
        )
        for message in messages:
            if message.get("sender_id") != user_id:
                message["read"] = True

    return {"messages": messages}


@app.post("/api/chat/{match_id}/read")
async def mark_messages_read(
    match_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Mark every message from the other participant as read."""
    user_id = current_user["user_id"]
    await require_match_participant(match_id, user_id)

    result = await messages_collection.update_many(
        {"match_id": match_id, "sender_id": {"$ne": user_id}, "read": False},
        {"$set": {"read": True, "read_at": get_utc_now()}},
    )

    if result.modified_count:
        await sio.emit(
            "messages_read",
            {"match_id": match_id, "reader_id": user_id},
            room=match_id,
        )

    return {"marked_read": result.modified_count}


@app.post("/api/chat/{match_id}/send")
async def send_message(
    match_id: str,
    message: MessageCreate,
    current_user: dict = Depends(get_current_user)
):
    """Send a message and broadcast it to the match room."""
    user_id = current_user["user_id"]
    match = await require_match_participant(match_id, user_id)

    content = message.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Create message
    msg_data = {
        "message_id": f"msg_{get_utc_now().timestamp()}",
        "match_id": match_id,
        "sender_id": user_id,
        "content": content,
        "type": message.type,
        "read": False,
        "created_at": get_utc_now()
    }
    await messages_collection.insert_one(msg_data)

    # Build a JSON-safe payload *before* emitting: insert_one mutates msg_data
    # with a non-serializable ObjectId, and `created_at` is a datetime, so the
    # previous emit could not be encoded by the Socket.io JSON packer.
    payload = {
        "message_id": msg_data["message_id"],
        "match_id": match_id,
        "sender_id": user_id,
        "content": content,
        "type": msg_data["type"],
        "read": False,
        "created_at": msg_data["created_at"].isoformat(),
    }

    await sio.emit("new_message", payload, room=match_id)

    # Also nudge the recipient's personal room so their matches list can refresh
    # its unread badge even when the chat screen is closed.
    other_id = match["user2_id"] if match["user1_id"] == user_id else match["user1_id"]
    await sio.emit("message_notification", {
        "match_id": match_id,
        "sender_id": user_id,
        "preview": content[:120],
    }, room=f"user:{other_id}")

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

    # Spinning up a deal room is the moment a match becomes a company attempt —
    # credit both founders.
    await gamification.award_many(room_data["participants"], "startups_created")

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


@app.post("/api/deal-rooms/{room_id}/generate-roadmap", dependencies=[Depends(ai_rate_limit)])
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

    await gamification.award(current_user["user_id"], "projects_count")

    return project_data


@app.get("/api/projects")
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


@app.get("/api/projects/mine")
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


@app.get("/api/projects/{project_id}")
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


@app.post("/api/projects/{project_id}/apply")
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


@app.get("/api/projects/{project_id}/applicants")
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


@app.patch("/api/projects/{project_id}/status")
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


# ===== AI ASSISTANT ROUTES =====

@app.get("/api/ai/business-ideas/{match_id}", dependencies=[Depends(ai_rate_limit)])
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


# ===== COMPATIBILITY DETAIL =====

async def _scored_pair(current_user: dict, other_user_id: str):
    """Load another user and score the pair. Shared by the two endpoints below."""
    await assert_not_blocked(current_user["user_id"], other_user_id)

    other = await users_collection.find_one({"user_id": other_user_id}, PUBLIC_USER_PROJECTION)
    if not other:
        raise HTTPException(status_code=404, detail="User not found")

    my_profile = current_user.get("profile") or {}
    their_profile = other.get("profile") or {}
    return other, my_profile, their_profile, score_compatibility(my_profile, their_profile)


@app.get("/api/compatibility/{user_id}", dependencies=[Depends(ai_rate_limit)])
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


@app.get("/api/compatibility/{user_id}/report", dependencies=[Depends(ai_rate_limit)])
async def get_compatibility_report(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Premium: deep compatibility report with founder-risk detection.

    This is the paywall's "Deep AI compatibility report" benefit. Gated on premium
    because it is the expensive call, and cached by pair.
    """
    if not current_user.get("premium"):
        raise HTTPException(
            status_code=402,
            detail="The deep compatibility report is a Premium feature.",
        )

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


# ===== AI COPILOT CHAT =====


class AICopilotRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: List[Dict[str, str]] = []


@app.post("/api/ai/copilot/chat", dependencies=[Depends(ai_rate_limit)])
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

async def _authenticate_socket(auth: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Resolve the user behind a socket handshake.

    Accepts the same bearer token as the REST API, so the client can reuse the
    token it already holds.
    """
    token = (auth or {}).get("token")
    if not token:
        return None
    try:
        return await get_current_user(authorization=f"Bearer {token}")
    except HTTPException:
        return None


@sio.event
async def connect(sid, environ, auth=None):
    """
    Authenticate the socket and put it in the user's personal room.

    Connections used to be anonymous, which meant a socket could join any match
    room and read another pair's messages. The token is now resolved up front and
    stored in the session; unauthenticated handshakes are refused.
    """
    user = await _authenticate_socket(auth)
    if not user:
        return False  # refuses the connection

    await sio.save_session(sid, {"user_id": user["user_id"]})
    # Personal room for match/message notifications outside an open chat
    await sio.enter_room(sid, f"user:{user['user_id']}")
    await sio.emit("connected", {"user_id": user["user_id"]}, room=sid)


@sio.event
async def disconnect(sid):
    pass


async def _socket_user_id(sid) -> Optional[str]:
    session = await sio.get_session(sid)
    return (session or {}).get("user_id")


@sio.event
async def join_match(sid, data):
    """Join a match room for real-time chat, if the caller belongs to that match."""
    match_id = (data or {}).get("match_id")
    user_id = await _socket_user_id(sid)
    if not match_id or not user_id:
        return

    match = await matches_collection.find_one(
        {"match_id": match_id}, {"_id": 0, "user1_id": 1, "user2_id": 1}
    )
    if not match or user_id not in [match["user1_id"], match["user2_id"]]:
        await sio.emit("join_error", {"match_id": match_id}, room=sid)
        return

    await sio.enter_room(sid, match_id)
    await sio.emit("joined", {"match_id": match_id}, room=sid)


@sio.event
async def leave_match(sid, data):
    """Leave a match room"""
    match_id = (data or {}).get("match_id")
    if match_id:
        await sio.leave_room(sid, match_id)


@sio.event
async def typing(sid, data):
    """
    Relay a typing indicator to the other participant.

    The user id comes from the authenticated session rather than the payload, so a
    client cannot type on someone else's behalf.
    """
    match_id = (data or {}).get("match_id")
    user_id = await _socket_user_id(sid)
    if match_id and user_id:
        await sio.emit(
            "user_typing",
            {"user_id": user_id, "match_id": match_id, "typing": bool((data or {}).get("typing", True))},
            room=match_id,
            skip_sid=sid,
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:socket_app", host="0.0.0.0", port=8001, reload=True)
