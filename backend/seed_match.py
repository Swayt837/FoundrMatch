"""
Seed a match between speed_test user and Aisha Patel for chat testing
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import users_collection, swipes_collection, matches_collection, messages_collection, get_utc_now


async def seed_match():
    # Find both users
    user1 = await users_collection.find_one({"email": "speed_test@t.com"})
    user2 = await users_collection.find_one({"email": "aisha.patel@demo.com"})
    
    if not user1 or not user2:
        print(f"Missing user. user1={bool(user1)}, user2={bool(user2)}")
        return
    
    u1_id = user1["user_id"]
    u2_id = user2["user_id"]
    
    # Create mutual right swipes
    for uid, tid in [(u1_id, u2_id), (u2_id, u1_id)]:
        await swipes_collection.update_one(
            {"user_id": uid, "target_user_id": tid},
            {"$set": {
                "user_id": uid,
                "target_user_id": tid,
                "direction": "right",
                "created_at": get_utc_now()
            }},
            upsert=True
        )
    
    # Create match
    match_id = f"match_{u1_id[:6]}_{u2_id[:6]}_seeded"
    await matches_collection.update_one(
        {"match_id": match_id},
        {"$set": {
            "match_id": match_id,
            "user1_id": u1_id,
            "user2_id": u2_id,
            "compatibility_score": {
                "skills_score": 92,
                "vision_score": 88,
                "availability_score": 100,
                "personality_score": 85,
                "objectives_score": 90,
                "work_style_score": 87,
                "overall_score": 90,
                "explanation": "This is a highly complementary pairing where a senior React developer meets a senior full-stack marketer with complementary skills and shared SaaS vision."
            },
            "status": "matched",
            "created_at": get_utc_now()
        }},
        upsert=True
    )
    
    # Seed some messages
    messages = [
        {"sender_id": u2_id, "content": "Hey! Excited to connect. I noticed we both want to build a SaaS."},
        {"sender_id": u1_id, "content": "Hi Aisha! Yes, your growth marketing background is exactly what I'm looking for."},
        {"sender_id": u2_id, "content": "Great! What kind of SaaS are you envisioning?"},
    ]
    
    for i, m in enumerate(messages):
        await messages_collection.update_one(
            {"message_id": f"seed_msg_{i}"},
            {"$set": {
                "message_id": f"seed_msg_{i}",
                "match_id": match_id,
                "sender_id": m["sender_id"],
                "content": m["content"],
                "type": "text",
                "read": True,
                "created_at": get_utc_now()
            }},
            upsert=True
        )
    
    print(f"Seeded match {match_id} between speed_test and Aisha Patel with {len(messages)} messages")


if __name__ == "__main__":
    asyncio.run(seed_match())
