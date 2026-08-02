"""
Registering a device for push notifications.

The token identifies one installation, not one user: the same person on a phone
and a tablet has two, and the same phone re-installed produces a new one. So
tokens are a list on the user document, and registering the same token twice
updates it rather than appending.

A token also has to be able to move between accounts. If two founders share a
device, or someone signs out and a colleague signs in, the token must stop
delivering to the previous account — otherwise one of them receives the other's
matches.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import push
from auth import get_current_user
from database import get_utc_now, users_collection

router = APIRouter(prefix="/api", tags=["notifications"])


class PushRegistration(BaseModel):
    token: str = Field(min_length=1, max_length=255)
    platform: str = Field(default="unknown", max_length=20)


@router.post("/push/register")
async def register_push_token(
    payload: PushRegistration,
    current_user: dict = Depends(get_current_user),
):
    """Attach this device's push token to the current account."""
    token = payload.token.strip()
    if not push.is_expo_token(token):
        raise HTTPException(status_code=400, detail="Not an Expo push token")

    # Detach first: the token may belong to whoever used this device last, and
    # leaving it there would send them notifications meant for someone else.
    await users_collection.update_many(
        {"push_tokens.token": token},
        {"$pull": {"push_tokens": {"token": token}}},
    )

    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {
            "$push": {
                "push_tokens": {
                    "token": token,
                    "platform": payload.platform,
                    "updated_at": get_utc_now(),
                }
            }
        },
    )

    return {"registered": True}


@router.delete("/push/register")
async def unregister_push_token(
    payload: PushRegistration,
    current_user: dict = Depends(get_current_user),
):
    """
    Detach a token, on sign-out.

    Without this, signing out stops the app from showing anything while the
    server keeps pushing this account's matches to a device someone else may now
    be holding.
    """
    await users_collection.update_one(
        {"user_id": current_user["user_id"]},
        {"$pull": {"push_tokens": {"token": payload.token.strip()}}},
    )
    return {"registered": False}
