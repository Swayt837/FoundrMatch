"""
Authentication utilities for CoFound
Supports both JWT-based email/password auth and Google OAuth
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
import httpx
from passlib.context import CryptContext
from jose import jwt
from fastapi import Header, HTTPException
from dotenv import load_dotenv
from database import (
    users_collection,
    user_sessions_collection,
    generate_user_id,
    get_utc_now,
    make_timezone_aware
)

load_dotenv()

# Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """
    Get current user from Bearer token
    Works with both JWT tokens and Emergent session tokens
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Extract token from "Bearer <token>"
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = parts[1]
    
    # Try as session token first (from Google OAuth)
    session = await user_sessions_collection.find_one(
        {"session_token": token},
        {"_id": 0}
    )
    
    if session:
        # Check if session is expired
        expires_at = session.get("expires_at")
        if expires_at:
            expires_at = make_timezone_aware(expires_at)
            if expires_at < get_utc_now():
                raise HTTPException(status_code=401, detail="Session expired")
        
        # Get user
        user = await users_collection.find_one(
            {"user_id": session["user_id"]},
            {"_id": 0, "password_hash": 0}
        )
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    
    # Try as JWT token (from email/password auth)
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("user_id")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    # Get user
    user = await users_collection.find_one(
        {"user_id": user_id},
        {"_id": 0, "password_hash": 0}
    )
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    
    return user


async def process_google_session(session_id: str) -> Dict[str, Any]:
    """
    Process Google OAuth session ID and return session data
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id}
        )
        
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        
        return response.json()


async def create_or_get_user_from_google(
    google_id: str,
    email: str,
    name: str,
    picture: str
) -> Dict[str, Any]:
    """
    Create or get user from Google OAuth data
    """
    # Check if user exists by email
    user = await users_collection.find_one({"email": email}, {"_id": 0})
    
    if user:
        # Update Google ID if not set
        if not user.get("google_id"):
            await users_collection.update_one(
                {"email": email},
                {"$set": {"google_id": google_id, "updated_at": get_utc_now()}}
            )
        return user
    
    # Create new user
    user_id = await generate_user_id()
    
    new_user = {
        "user_id": user_id,
        "email": email,
        "google_id": google_id,
        "profile": {
            "name": name,
            "photos": [picture] if picture else [],
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
            "email_verified": True,  # Google email is verified
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
    
    # Remove _id from response
    new_user.pop("_id", None)
    return new_user


async def store_session(session_token: str, user_id: str):
    """Store session token in database"""
    expires_at = get_utc_now() + timedelta(days=7)
    
    session = {
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": expires_at,
        "created_at": get_utc_now()
    }
    
    # Upsert session
    await user_sessions_collection.update_one(
        {"session_token": session_token},
        {"$set": session},
        upsert=True
    )
