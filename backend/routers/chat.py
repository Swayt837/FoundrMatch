"""
Chat routes: message history, read receipts and sending.

Real-time delivery is handled by the Socket.io server in `realtime`; these endpoints
own persistence and are what the client falls back to when the socket is down.
"""
from fastapi import APIRouter, Depends, HTTPException

from access import require_match_participant
from auth import get_current_user
from database import get_utc_now, messages_collection
from models import MessageCreate
from realtime import sio

router = APIRouter(prefix="/api", tags=["chat"])


@router.get("/chat/{match_id}/messages")
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

@router.post("/chat/{match_id}/read")
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

@router.post("/chat/{match_id}/send")
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
