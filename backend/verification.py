"""
Proving a founder is who they say they are.

The `verification` block has been on every user document since the first version
with nothing able to set it: five booleans, all permanently false except the one
Google sign-in happened to flip. On a platform where strangers hand each other
equity, that is not a cosmetic gap.

Four methods, and they are not equally strong — the UI has to say which is which:

- **Email** — a code to the address on file. Proves the address is reachable by
  this person. The floor for any account that will be given a stranger's phone
  number.
- **GitHub** — OAuth. Proves control of the account, and the account's own age
  and history are visible to whoever looks. The strongest signal here for a
  technical cofounder.
- **Website** — a token placed on a page at a domain they claim. Proves control
  of the domain, which is what "this is my company" means in practice.
- **LinkedIn** — a declared link, deliberately **not** verified. LinkedIn's API
  requires app review for profile access, so anything else would be theatre; it
  is stored and displayed as a claim, never as a checkmark.
"""
import hashlib
import os
import re
import secrets
from datetime import timedelta
from typing import Any, Dict, Optional

import httpx

from database import get_utc_now, users_collection

# ===== Email codes =====

CODE_TTL = timedelta(minutes=15)
CODE_MAX_ATTEMPTS = 5


def new_code() -> str:
    """A six-digit code. Short enough to retype, guarded by attempts and expiry."""
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(code: str, user_id: str) -> str:
    """
    Stored instead of the code itself.

    Salted with the user id so the same digits do not produce the same hash for
    two people, which would make the column trivially reversible with a table of
    a million entries.
    """
    return hashlib.sha256(f"{user_id}:{code}".encode()).hexdigest()


async def store_email_challenge(user_id: str, code: str) -> None:
    await users_collection.update_one(
        {"user_id": user_id},
        {"$set": {
            "verification.email_challenge": {
                "hash": hash_code(code, user_id),
                "expires_at": get_utc_now() + CODE_TTL,
                "attempts": 0,
            }
        }},
    )


async def check_email_code(user: Dict[str, Any], code: str) -> str:
    """
    `"ok"`, or a reason the code was refused.

    Attempts are counted and capped: six digits is 1 in a million per guess, and
    unlimited guesses turn that into a certainty.
    """
    challenge = (user.get("verification") or {}).get("email_challenge")
    if not challenge:
        return "Ask for a new code first"

    expires_at = challenge.get("expires_at")
    if expires_at and expires_at.replace(tzinfo=expires_at.tzinfo or None) < get_utc_now():
        return "That code has expired — ask for a new one"

    if challenge.get("attempts", 0) >= CODE_MAX_ATTEMPTS:
        return "Too many attempts — ask for a new code"

    if not secrets.compare_digest(challenge.get("hash", ""), hash_code(code, user["user_id"])):
        await users_collection.update_one(
            {"user_id": user["user_id"]},
            {"$inc": {"verification.email_challenge.attempts": 1}},
        )
        return "That code is not right"

    return "ok"


async def mark_verified(user_id: str, method: str, **extra: Any) -> None:
    """Record a successful verification and drop whatever proved it."""
    updates: Dict[str, Any] = {
        f"verification.{method}_verified": True,
        f"verification.{method}_verified_at": get_utc_now(),
    }
    updates.update({f"verification.{key}": value for key, value in extra.items()})

    await users_collection.update_one(
        {"user_id": user_id},
        {"$set": updates, "$unset": {"verification.email_challenge": ""}},
    )


# ===== GitHub =====

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "").strip()
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "").strip()

GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN = "https://github.com/login/oauth/access_token"
GITHUB_USER = "https://api.github.com/user"


def github_configured() -> bool:
    return bool(GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)


def github_authorize_url(state: str, redirect_uri: str) -> str:
    # No scopes at all: the default grants public profile data, which is the
    # entirety of what proving account ownership needs. Asking for repo access
    # to display a username would be indefensible.
    return (
        f"{GITHUB_AUTHORIZE}?client_id={GITHUB_CLIENT_ID}"
        f"&state={state}&redirect_uri={redirect_uri}&scope="
    )


async def github_identity(code: str, redirect_uri: str) -> Dict[str, Any]:
    """Exchange an OAuth code for the account it belongs to."""
    async with httpx.AsyncClient(timeout=10) as client:
        token_response = await client.post(
            GITHUB_TOKEN,
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Accept": "application/json"},
        )
        token = (token_response.json() or {}).get("access_token")
        if not token:
            raise ValueError("GitHub did not return an access token")

        user_response = await client.get(
            GITHUB_USER,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        if user_response.status_code >= 400:
            raise ValueError("GitHub refused to identify the account")

        profile = user_response.json() or {}

    return {
        "username": profile.get("login"),
        "created_at": profile.get("created_at"),
        "public_repos": profile.get("public_repos"),
    }


# ===== Website =====

META_NAME = "cofoundr-verification"
_META_PATTERN = re.compile(
    r'<meta[^>]+name=["\']' + META_NAME + r'["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
# Attribute order is not fixed in HTML, and hand-written tags routinely put
# content first.
_META_PATTERN_REVERSED = re.compile(
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']' + META_NAME + r'["\']',
    re.IGNORECASE,
)


def website_token() -> str:
    return f"cofoundr-{secrets.token_hex(16)}"


def find_token(html: str) -> Optional[str]:
    """The verification token in a page, whichever order its attributes are in."""
    for pattern in (_META_PATTERN, _META_PATTERN_REVERSED):
        match = pattern.search(html)
        if match:
            return match.group(1).strip()
    return None


def meta_tag(token: str) -> str:
    """What the founder pastes into their site's <head>."""
    return f'<meta name="{META_NAME}" content="{token}">'
