"""
Database connection and utilities
"""
import os
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

# MongoDB connection
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "cofound_db")
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Collections
users_collection = db.users
swipes_collection = db.swipes
matches_collection = db.matches
messages_collection = db.messages
deal_rooms_collection = db.deal_rooms
projects_collection = db.projects
user_sessions_collection = db.user_sessions
notifications_collection = db.notifications
payment_transactions_collection = db.payment_transactions
blocks_collection = db.blocks
reports_collection = db.reports
compatibility_cache_collection = db.compatibility_cache


async def create_indexes():
    """Create database indexes for optimal performance"""
    
    # Users indexes
    await users_collection.create_index("email", unique=True)
    await users_collection.create_index("user_id", unique=True)
    await users_collection.create_index([("profile.city", 1)])
    await users_collection.create_index([("profile.profession", 1)])
    await users_collection.create_index([("gamification.level", -1)])
    
    # Sessions indexes
    await user_sessions_collection.create_index("session_token", unique=True)
    await user_sessions_collection.create_index("user_id")
    await user_sessions_collection.create_index(
        "expires_at",
        expireAfterSeconds=0
    )
    
    # Swipes indexes
    await swipes_collection.create_index([("user_id", 1), ("target_user_id", 1)])
    await swipes_collection.create_index([("user_id", 1), ("created_at", -1)])
    
    # Matches indexes
    await matches_collection.create_index([("user1_id", 1), ("user2_id", 1)])
    await matches_collection.create_index([("user1_id", 1)])
    await matches_collection.create_index([("user2_id", 1)])
    await matches_collection.create_index([("compatibility_score.overall_score", -1)])
    
    # Messages indexes
    await messages_collection.create_index([("match_id", 1), ("created_at", 1)])
    await messages_collection.create_index([("match_id", 1), ("read", 1)])
    
    # Projects indexes
    await projects_collection.create_index([("user_id", 1)])
    await projects_collection.create_index([("status", 1)])
    await projects_collection.create_index([("looking_for", 1)])
    
    # Deal Rooms indexes
    await deal_rooms_collection.create_index([("match_id", 1)])
    await deal_rooms_collection.create_index([("participants", 1)])

    # Moderation indexes
    await blocks_collection.create_index(
        [("blocker_id", 1), ("blocked_id", 1)], unique=True
    )
    await blocks_collection.create_index([("blocked_id", 1)])
    await reports_collection.create_index([("reported_id", 1), ("created_at", -1)])
    await reports_collection.create_index([("reporter_id", 1)])

    # Compatibility cache: expire entries so profile edits eventually take effect
    # even when the targeted invalidation misses. Not declared unique — creating a
    # unique index would abort startup if any legacy duplicate exists, and the
    # upsert-by-pair_key write path already keeps entries unique.
    await compatibility_cache_collection.create_index("pair_key")
    await compatibility_cache_collection.create_index(
        "created_at", expireAfterSeconds=60 * 60 * 24 * 30
    )


async def run_migrations():
    """
    Idempotent data fixes applied at startup.

    Kept small and safe to re-run: this is not a migration framework, just a way
    to stop old documents from carrying fields the code no longer reads.
    """
    # `premium` moved to the document root; the copy under `settings` was never
    # updated after a purchase, so anything still reading it saw every user as free.
    result = await users_collection.update_many(
        {"settings.premium": {"$exists": True}},
        {"$unset": {"settings.premium": ""}},
    )
    if result.modified_count:
        print(f"✅ Migration: removed stale settings.premium from {result.modified_count} user(s)")

    # Ensure the root flag exists so queries on it behave predictably.
    result = await users_collection.update_many(
        {"premium": {"$exists": False}},
        {"$set": {"premium": False}},
    )
    if result.modified_count:
        print(f"✅ Migration: initialised premium=false on {result.modified_count} user(s)")


async def generate_user_id() -> str:
    """Generate a unique user ID"""
    import uuid
    return f"user_{uuid.uuid4().hex[:12]}"


def get_utc_now() -> datetime:
    """Get current UTC datetime with timezone info"""
    return datetime.now(timezone.utc)


def make_timezone_aware(dt: datetime) -> datetime:
    """Make a naive datetime timezone-aware (UTC)"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
