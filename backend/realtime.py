"""
Real-time layer: the Socket.io server and its event handlers.

Owns `sio` so that routers can emit without importing `server` — `server` composes
the routers, so any router importing it back would be circular.

Sockets are authenticated with the same bearer token as the REST API. Connections
used to be anonymous, which meant a socket could join any match room and read
another pair's messages.

This module also carries the signalling for founder-to-founder video calls. The
server is a **relay, not a participant**: it never parses an SDP offer or holds call
state. Two reasons — the media never touches our infrastructure (WebRTC is
peer-to-peer, so the only cost is signalling), and a server-side call state machine
is a second source of truth that desyncs from the peers the first time a phone loses
signal mid-handshake. What the server does enforce is *who may ring whom*: every
event is authorised against the match, so a socket cannot call a stranger.
"""
import os
import uuid
from typing import Any, Dict, Optional, Tuple

import socketio
from fastapi import HTTPException

from auth import get_current_user
from database import matches_collection

# SDP blobs run to a few kilobytes; ICE candidates are tiny. The cap stops the
# signalling channel from being used to push arbitrary payloads at another user.
MAX_SIGNAL_BYTES = 64 * 1024

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


# ===== Video call signalling =====

async def _call_peer(sid, data) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Resolve `(user_id, other_user_id, match_id)` for a call event.

    Returns `(None, None, None)` and tells the caller when the socket is not a
    participant of the match it is trying to signal on. Every call handler goes
    through here, so authorisation cannot be forgotten in one of them.
    """
    match_id = (data or {}).get("match_id")
    user_id = await _socket_user_id(sid)
    if not match_id or not user_id:
        return None, None, None

    match = await matches_collection.find_one(
        {"match_id": match_id}, {"_id": 0, "user1_id": 1, "user2_id": 1}
    )
    if not match or user_id not in [match["user1_id"], match["user2_id"]]:
        await sio.emit("call_error", {"match_id": match_id, "reason": "not_authorized"}, room=sid)
        return None, None, None

    other = match["user2_id"] if user_id == match["user1_id"] else match["user1_id"]
    return user_id, other, match_id


@sio.event
async def call_invite(sid, data):
    """
    Ring the other founder.

    The call id is minted here rather than accepted from the client: both sides need
    to agree on which call a later `call_signal` belongs to, and a client-chosen id
    could collide with, or deliberately hijack, another call in flight.

    Delivery goes to the callee's *personal* room, not the match room — an incoming
    call has to reach them whether or not they have the conversation open.
    """
    user_id, other, match_id = await _call_peer(sid, data)
    if not user_id:
        return

    media = "audio" if (data or {}).get("media") == "audio" else "video"
    call_id = f"call_{uuid.uuid4().hex}"

    await sio.emit(
        "call_incoming",
        {"call_id": call_id, "match_id": match_id, "from_user_id": user_id, "media": media},
        room=f"user:{other}",
    )
    # Echoed back so the caller knows the id to sign its own signalling with.
    await sio.emit(
        "call_ringing",
        {"call_id": call_id, "match_id": match_id, "media": media},
        room=sid,
    )


@sio.event
async def call_accept(sid, data):
    """Accept a ringing call. The caller starts the WebRTC offer on this."""
    user_id, other, match_id = await _call_peer(sid, data)
    if not user_id:
        return

    await sio.emit(
        "call_accepted",
        {"call_id": (data or {}).get("call_id"), "match_id": match_id, "from_user_id": user_id},
        room=f"user:{other}",
    )


@sio.event
async def call_decline(sid, data):
    """Decline a ringing call."""
    user_id, other, match_id = await _call_peer(sid, data)
    if not user_id:
        return

    await sio.emit(
        "call_declined",
        {
            "call_id": (data or {}).get("call_id"),
            "match_id": match_id,
            "from_user_id": user_id,
            "reason": (data or {}).get("reason") or "declined",
        },
        room=f"user:{other}",
    )


@sio.event
async def call_end(sid, data):
    """
    Hang up.

    Sent on every ending — answered, unanswered, or failed — so the other side never
    sits on a dead connection waiting for a timeout.
    """
    user_id, other, match_id = await _call_peer(sid, data)
    if not user_id:
        return

    await sio.emit(
        "call_ended",
        {"call_id": (data or {}).get("call_id"), "match_id": match_id, "from_user_id": user_id},
        room=f"user:{other}",
    )


@sio.event
async def call_signal(sid, data):
    """
    Relay one WebRTC signalling message (SDP offer/answer or an ICE candidate).

    The payload is opaque here on purpose: parsing SDP would add a way to get it
    wrong without adding anything. Only the envelope is checked.
    """
    user_id, other, match_id = await _call_peer(sid, data)
    if not user_id:
        return

    signal = (data or {}).get("signal")
    if signal is None:
        return
    if len(str(signal)) > MAX_SIGNAL_BYTES:
        await sio.emit(
            "call_error",
            {"match_id": match_id, "reason": "signal_too_large"},
            room=sid,
        )
        return

    await sio.emit(
        "call_signal",
        {
            "call_id": (data or {}).get("call_id"),
            "match_id": match_id,
            "from_user_id": user_id,
            "signal": signal,
        },
        room=f"user:{other}",
    )


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
