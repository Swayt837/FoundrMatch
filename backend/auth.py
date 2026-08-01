"""
Authentication utilities for CoFoundr.

Email/password and Google sign-in both end at the same place: a JWT this backend
issued. Google used to end somewhere else — an opaque session token minted by
Emergent's hosted OAuth service, which this backend accepted without verifying
anything itself. Google now hands us an identity token we verify against Google's
own signing keys (`verify_google_id_token`), and we mint our own JWT from it.
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

from passlib.context import CryptContext
from jose import jwt
from fastapi import Header, HTTPException
from dotenv import load_dotenv
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from database import (
    users_collection,
    generate_user_id,
    get_utc_now,
)

load_dotenv()

# Configuration
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
_DEV_SECRET = "dev-only-insecure-secret"
SECRET_KEY = os.getenv("SECRET_KEY", "")

if not SECRET_KEY:
    # Refuse to boot outside development rather than silently signing every token
    # with a value that is public in the source tree.
    if ENVIRONMENT != "development":
        raise RuntimeError(
            "SECRET_KEY environment variable is required when ENVIRONMENT is not 'development'"
        )
    print("⚠️  SECRET_KEY is unset — using an insecure development key")
    SECRET_KEY = _DEV_SECRET

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

# bcrypt silently truncates beyond 72 bytes, so passwords are length-checked first
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def validate_password_strength(password: str) -> None:
    """Reject passwords the client-side hint alone would have let through."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
    if len(password) > MAX_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at most {MAX_PASSWORD_LENGTH} characters",
        )
    if password.lower() in {"password", "12345678", "qwertyui", "iloveyou"}:
        raise HTTPException(status_code=400, detail="Please choose a less common password")


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
    Resolve the user behind a Bearer token.

    One credential type: a JWT this backend signed. There used to be a second — an
    opaque Google session token looked up in `user_sessions` — and it was checked
    *first*, so every authenticated request in the app paid a database round trip
    before falling through to the JWT it almost always was.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Extract token from "Bearer <token>"
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = parts[1]

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


# The OAuth client IDs this backend will accept a token for — one per platform
# (iOS, Android, Web), comma-separated. Google issues a token whose `aud` is the
# client that requested it, so all three have to be listed.
GOOGLE_CLIENT_IDS = [
    client_id.strip()
    for client_id in os.getenv("GOOGLE_CLIENT_IDS", "").split(",")
    if client_id.strip()
]

# The only issuers Google signs identity tokens with.
_GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")


async def verify_google_id_token(token: str) -> Dict[str, Any]:
    """
    Verify a Google ID token and return its claims.

    This replaces a call to Emergent's hosted OAuth service, which handed back
    session data this backend trusted without checking anything itself.

    Three checks, each of which is load-bearing:

    - **Signature and expiry** (`verify_oauth2_token`). Without it the token is just
      a base64 string anyone can write.
    - **Audience.** A validly-signed Google token issued to *some other application*
      is still a real Google token. Accepting it would let any developer with a Google
      OAuth client sign in as any of our users. `verify_oauth2_token` takes a single
      audience, and we have one client ID per platform, so the check is done here
      against the allowlist instead.
    - **`email_verified`.** `create_or_get_user_from_google` matches an existing
      account by email, so an unverified address is an account-takeover route: claim
      someone's email on a throwaway Google account, sign in, inherit their profile.

    Verification fetches and caches Google's signing certificates over HTTP, and the
    library is synchronous — running it inline would block the event loop for every
    other request in flight, so it goes to a worker thread.
    """
    if not GOOGLE_CLIENT_IDS:
        raise HTTPException(
            status_code=503,
            detail="Google sign-in is not configured on this server.",
        )

    try:
        claims = await asyncio.to_thread(
            google_id_token.verify_oauth2_token,
            token,
            google_requests.Request(),
            # Audience deliberately unset — checked against the allowlist below.
            None,
        )
    except (ValueError, GoogleAuthError):
        # Bad signature, expired, or malformed. The reason is not the caller's
        # business and saying which one helps an attacker iterate.
        raise HTTPException(status_code=401, detail="Invalid Google token")

    if claims.get("aud") not in GOOGLE_CLIENT_IDS:
        raise HTTPException(status_code=401, detail="Token was not issued for this app")

    if claims.get("iss") not in _GOOGLE_ISSUERS:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    if not claims.get("email") or not claims.get("email_verified"):
        raise HTTPException(
            status_code=401,
            detail="Your Google account must have a verified email address.",
        )

    return claims


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
            "show_age": True
        },
        "premium": False,
        "onboarding_completed": False,
        "created_at": get_utc_now(),
        "updated_at": get_utc_now(),
        "last_active": get_utc_now()
    }
    
    await users_collection.insert_one(new_user)
    
    # Remove _id from response
    new_user.pop("_id", None)
    return new_user


