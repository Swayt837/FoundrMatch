"""
Authentication routes: registration, email/password login, Google sign-in.

All three issue the same credential — a JWT signed by this backend. See `auth` for
why Google no longer gets its own session-token path.
"""
from fastapi import APIRouter, Body, Depends, HTTPException

from auth import (
    create_access_token,
    create_or_get_user_from_google,
    get_current_user,
    get_password_hash,
    validate_password_strength,
    verify_google_id_token,
    verify_password,
)
from database import generate_user_id, get_utc_now, users_collection
from deps import auth_rate_limit
from models import UserLogin, UserRegistration
from serializers import private_user

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/auth/register", dependencies=[Depends(auth_rate_limit)])
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

@router.post("/auth/login", dependencies=[Depends(auth_rate_limit)])
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

@router.post("/auth/google/callback", dependencies=[Depends(auth_rate_limit)])
async def google_callback(id_token: str = Body(..., embed=True)):
    """
    Sign in with a Google identity token.

    The client runs the OAuth flow with Google directly and posts the resulting ID
    token here; `verify_google_id_token` checks its signature, audience and verified
    email before we trust a single field of it.

    The response is the same shape as `/auth/login` — an `access_token` this backend
    signed. Google sign-in used to return an opaque session token instead, which made
    it a second credential type with its own storage and its own lookup on every
    request.

    `id_token` is declared as a Body field because a bare `str` parameter is read
    from the query string by FastAPI, which would put a credential in the URL — and
    in access logs.
    """
    claims = await verify_google_id_token(id_token)

    user = await create_or_get_user_from_google(
        google_id=claims["sub"],
        email=claims["email"],
        name=claims.get("name") or claims["email"].split("@")[0],
        picture=claims.get("picture", ""),
    )

    access_token = create_access_token({"user_id": user["user_id"]})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user["user_id"],
        "onboarding_completed": user.get("onboarding_completed", False),
    }

@router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Get current user profile"""
    return private_user(current_user)

@router.post("/auth/logout")
async def logout():
    """
    Log out.

    Credentials are stateless JWTs, so there is nothing server-side to revoke — the
    client discards its token. This used to delete a row from `user_sessions`, which
    only ever did anything for the Google session tokens that no longer exist.

    Kept as an endpoint because the client calls it, and because it is where token
    revocation would go if we add it.
    """
    return {"message": "Logged out successfully"}
