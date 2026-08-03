"""
Verification routes: email, GitHub, website, and a declared LinkedIn link.

Every method that needs an outside service degrades to 503 with a message naming
what is missing, rather than failing obscurely — the same shape as storage,
Stripe and Google sign-in.
"""
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import mailer
import net_guard
import verification as verify
from auth import get_current_user
from database import get_utc_now, users_collection
from rate_limit import RateLimiter

router = APIRouter(prefix="/api/verify", tags=["verification"])

STATE_TTL = timedelta(minutes=10)


@router.get("/status")
async def verification_status(current_user: dict = Depends(get_current_user)):
    """
    What is verified, what could be, and what this deployment can offer.

    `available` lets the client hide a method the server cannot perform instead
    of showing a button that answers 503.
    """
    stored = current_user.get("verification") or {}

    return {
        "email": {
            "verified": bool(stored.get("email_verified")),
            "available": mailer.configured(),
            "address": current_user.get("email"),
        },
        "github": {
            "verified": bool(stored.get("github_verified")),
            "available": verify.github_configured(),
            "username": stored.get("github_username"),
        },
        "website": {
            "verified": bool(stored.get("website_verified")),
            "available": True,
            "url": stored.get("website_url"),
        },
        # Displayed as a claim, never as a checkmark — see verification.py.
        "linkedin": {
            "verified": False,
            "available": True,
            "url": stored.get("linkedin_url"),
            "note": "Shown as a link you provided, not as a verified account.",
        },
    }


# ===== Email =====

@router.post(
    "/email/send",
    dependencies=[Depends(RateLimiter("verify_email", limit=4, window=900))],
)
async def send_email_code(current_user: dict = Depends(get_current_user)):
    """Send a six-digit code to the address on the account."""
    if not mailer.configured():
        raise HTTPException(
            status_code=503,
            detail="Email verification is not configured on this server.",
        )

    if (current_user.get("verification") or {}).get("email_verified"):
        return {"sent": False, "already_verified": True}

    code = verify.new_code()
    await verify.store_email_challenge(current_user["user_id"], code)

    subject, html, text = mailer.verification_email(code)
    try:
        await mailer.send(current_user["email"], subject, html, text)
    except mailer.MailError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"sent": True, "expires_in_minutes": int(verify.CODE_TTL.total_seconds() // 60)}


class EmailCode(BaseModel):
    code: str = Field(min_length=4, max_length=10)


@router.post(
    "/email/confirm",
    dependencies=[Depends(RateLimiter("verify_email_confirm", limit=10, window=900))],
)
async def confirm_email_code(
    payload: EmailCode,
    current_user: dict = Depends(get_current_user),
):
    result = await verify.check_email_code(current_user, payload.code.strip())
    if result != "ok":
        raise HTTPException(status_code=400, detail=result)

    await verify.mark_verified(current_user["user_id"], "email")
    return {"verified": True}


# ===== GitHub =====

class GitHubStart(BaseModel):
    redirect_uri: str = Field(min_length=1, max_length=500)


@router.post("/github/start")
async def start_github(
    payload: GitHubStart,
    current_user: dict = Depends(get_current_user),
):
    """
    Begin the OAuth flow.

    The `state` is stored server-side against this user and checked on the way
    back. Without it, an attacker can complete the flow with their own GitHub
    account in a victim's session and have their account marked as the victim's.
    """
    if not verify.github_configured():
        raise HTTPException(
            status_code=503,
            detail="GitHub verification is not configured on this server.",
        )

    state = secrets.token_urlsafe(24)
    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"verification.github_state": {
            "state": state,
            "redirect_uri": payload.redirect_uri,
            "expires_at": get_utc_now() + STATE_TTL,
        }}},
    )

    return {"url": verify.github_authorize_url(state, payload.redirect_uri)}


class GitHubCallback(BaseModel):
    code: str = Field(min_length=1, max_length=500)
    state: str = Field(min_length=1, max_length=200)


@router.post("/github/callback")
async def finish_github(
    payload: GitHubCallback,
    current_user: dict = Depends(get_current_user),
):
    stored = (current_user.get("verification") or {}).get("github_state") or {}

    if not stored.get("state") or not secrets.compare_digest(stored["state"], payload.state):
        raise HTTPException(status_code=400, detail="That verification link is no longer valid")

    expires_at = stored.get("expires_at")
    if expires_at and expires_at < get_utc_now():
        raise HTTPException(status_code=400, detail="That verification link has expired")

    try:
        identity = await verify.github_identity(payload.code, stored["redirect_uri"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not identity.get("username"):
        raise HTTPException(status_code=400, detail="GitHub did not return an account")

    # One GitHub account per founder: without this, one account could verify any
    # number of profiles, which is exactly the fraud the badge exists to prevent.
    taken = await users_collection.find_one(
        {
            "verification.github_username": identity["username"],
            "user_id": {"$ne": current_user["user_id"]},
        },
        {"_id": 0, "user_id": 1},
    )
    if taken:
        raise HTTPException(
            status_code=409,
            detail="That GitHub account is already verified on another profile",
        )

    await verify.mark_verified(
        current_user["user_id"],
        "github",
        github_username=identity["username"],
        github_created_at=identity.get("created_at"),
        github_public_repos=identity.get("public_repos"),
    )
    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$unset": {"verification.github_state": ""}},
    )

    return {"verified": True, "username": identity["username"]}


# ===== Website =====

class WebsiteStart(BaseModel):
    url: str = Field(min_length=1, max_length=500)


@router.post(
    "/website/start",
    dependencies=[Depends(RateLimiter("verify_website", limit=10, window=900))],
)
async def start_website(
    payload: WebsiteStart,
    current_user: dict = Depends(get_current_user),
):
    """Issue a token to place on the site, and say where to put it."""
    url = net_guard.normalise(payload.url)
    if not url:
        raise HTTPException(status_code=400, detail="That does not look like a web address")

    try:
        net_guard.assert_fetchable(url)
    except net_guard.UnsafeURL as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    token = verify.website_token()
    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"verification.website_challenge": {"url": url, "token": token}}},
    )

    return {
        "url": url,
        "token": token,
        "meta_tag": verify.meta_tag(token),
        "instructions": "Add this tag inside the <head> of that page, then confirm.",
    }


@router.post(
    "/website/confirm",
    dependencies=[Depends(RateLimiter("verify_website", limit=10, window=900))],
)
async def confirm_website(current_user: dict = Depends(get_current_user)):
    """Fetch the page and look for the token."""
    challenge = (current_user.get("verification") or {}).get("website_challenge") or {}
    if not challenge.get("token"):
        raise HTTPException(status_code=400, detail="Start the website check first")

    try:
        html = await net_guard.fetch_text(challenge["url"])
    except net_guard.UnsafeURL as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    found = verify.find_token(html)
    if found != challenge["token"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "The tag was not found on that page. It has to be in the HTML the "
                "server sends — a tag added by JavaScript after load is not visible here."
            ),
        )

    await verify.mark_verified(
        current_user["user_id"], "website", website_url=challenge["url"]
    )
    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$unset": {"verification.website_challenge": ""}},
    )

    return {"verified": True, "url": challenge["url"]}


# ===== LinkedIn (declared, not verified) =====

class LinkedInLink(BaseModel):
    url: Optional[str] = Field(default=None, max_length=500)


@router.put("/linkedin")
async def set_linkedin(
    payload: LinkedInLink,
    current_user: dict = Depends(get_current_user),
):
    """
    Store a LinkedIn URL as a claim.

    Not verified, and deliberately not pretending to be: LinkedIn requires app
    review for profile access, so a checkmark here would mean "this founder
    typed a URL". The field is separate from the verified ones so the client
    cannot accidentally render it as one.
    """
    if payload.url is None or not payload.url.strip():
        await users_collection.update_one(
            {"user_id": current_user["user_id"]},
            {"$unset": {"verification.linkedin_url": ""}},
        )
        return {"url": None}

    url = net_guard.normalise(payload.url)
    if not url or "linkedin.com" not in url.lower():
        raise HTTPException(status_code=400, detail="Enter a linkedin.com profile address")

    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"verification.linkedin_url": url}},
    )
    return {"url": url}
