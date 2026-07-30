"""
Real-time layer: the Socket.io server and its event handlers.

Owns `sio` so that routers can emit without importing `server` — `server` composes
the routers, so any router importing it back would be circular.

Sockets are authenticated with the same bearer token as the REST API. Connections
used to be anonymous, which meant a socket could join any match room and read
another pair's messages.
"""
import os
from typing import Any, Dict, Optional

import socketio
from fastapi import HTTPException

from auth import get_current_user
from database import matches_collection

# Allowed origins mirror the CORS configuration in `server`.
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]
_allow_any_origin = "*" in ALLOWED_ORIGINS

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*" if _allow_any_origin else ALLOWED_ORIGINS,
    logger=False,
    engineio_logger=False,
)


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
