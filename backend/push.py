"""
Push notifications, through Expo's push service.

Everything this app does that matters to the other person — a match, a message,
a cofounder proposing an equity split — was only ever delivered over an open
socket. If the app was closed, which is most of the time, it was delivered
nowhere. A matching product with no way to tell you someone matched with you is
a product people open once.

Expo relays to APNs and FCM, so there are no per-platform credentials here; EAS
holds those. Sending needs no key at all, though setting `EXPO_ACCESS_TOKEN`
enables Expo's additional security check on the sending account.

Failures are swallowed on purpose. A notification that does not send must never
take down the action that triggered it: the match still happened.
"""
import asyncio
import os
from typing import Any, Dict, Iterable, List, Optional

import httpx

from database import users_collection

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_ACCESS_TOKEN = os.getenv("EXPO_ACCESS_TOKEN", "").strip()

# Expo caps a request at 100 messages.
BATCH_SIZE = 100
TIMEOUT_SECONDS = 10


def is_expo_token(token: str) -> bool:
    """Expo's own token format. Anything else would be rejected downstream."""
    return isinstance(token, str) and (
        token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")
    )


async def tokens_for(user_ids: Iterable[str], exclude: Optional[str] = None) -> List[str]:
    """
    Push tokens for these users, honouring their notification setting.

    `notifications_enabled` has been in the settings screen from the start with
    nothing reading it — a switch that turned nothing off. This is the thing that
    reads it.
    """
    targets = [uid for uid in user_ids if uid and uid != exclude]
    if not targets:
        return []

    users = await users_collection.find(
        {
            "user_id": {"$in": targets},
            "push_tokens.0": {"$exists": True},
            # Absent means enabled: the default is on, and older accounts have no
            # settings block at all.
            "settings.notifications_enabled": {"$ne": False},
        },
        {"_id": 0, "push_tokens": 1},
    ).to_list(None)

    return [
        entry["token"]
        for user in users
        for entry in user.get("push_tokens") or []
        if is_expo_token(entry.get("token", ""))
    ]


async def _prune(tokens: Iterable[str]) -> None:
    """
    Drop tokens Expo says are dead.

    A device that uninstalled the app keeps its token in our database forever
    otherwise, and every later send pays for it.
    """
    for token in tokens:
        await users_collection.update_many(
            {"push_tokens.token": token},
            {"$pull": {"push_tokens": {"token": token}}},
        )


async def send(
    user_ids: Iterable[str],
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    exclude: Optional[str] = None,
) -> int:
    """
    Deliver one notification to every device of these users. Returns how many
    messages were accepted.

    `exclude` is normally the person who caused the event — nobody needs to be
    told what they just did.
    """
    tokens = await tokens_for(user_ids, exclude=exclude)
    if not tokens:
        return 0

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "sound": "default",
            # `data` is what the app reads to open the right screen on tap.
            "data": data or {},
        }
        for token in tokens
    ]

    headers = {"Content-Type": "application/json"}
    if EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {EXPO_ACCESS_TOKEN}"

    accepted = 0
    dead: List[str] = []

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            for start in range(0, len(messages), BATCH_SIZE):
                batch = messages[start:start + BATCH_SIZE]
                response = await client.post(EXPO_PUSH_URL, json=batch, headers=headers)
                if response.status_code >= 400:
                    print(f"[push] Expo returned {response.status_code}: {response.text[:200]}")
                    continue

                for message, receipt in zip(batch, response.json().get("data") or []):
                    if receipt.get("status") == "ok":
                        accepted += 1
                    elif (receipt.get("details") or {}).get("error") == "DeviceNotRegistered":
                        dead.append(message["to"])
    except Exception as exc:
        # Never let a notification failure surface as a failed request.
        print(f"[push] send failed: {exc}")
        return accepted

    if dead:
        await _prune(dead)

    return accepted


def send_soon(*args: Any, **kwargs: Any) -> None:
    """
    Fire a notification without waiting for it.

    Used from request handlers: the caller is answering an HTTP request, and a
    slow round trip to Expo should not be part of its latency.
    """
    task = asyncio.create_task(send(*args, **kwargs))
    # Held so the loop does not garbage-collect a pending task mid-flight.
    _background.add(task)
    task.add_done_callback(_background.discard)


_background: set = set()
