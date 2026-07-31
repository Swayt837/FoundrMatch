"""
Seed demo founder profiles for the Discover screen.

Run: SEED_PASSWORD=... python backend/seed_profiles.py

The password comes from the environment and has no default. It used to be the
literal "demo123", written here in a public repository — which meant that once
the backend was deployed, anyone reading this file could sign in as any of the
eight demo founders. Re-running the script now also rotates the password on
accounts that already exist, so a leaked one can actually be replaced.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import users_collection, get_utc_now, generate_user_id
from auth import get_password_hash, MIN_PASSWORD_LENGTH


def seed_password() -> str:
    """
    The password every demo account gets.

    Deliberately has no fallback: a default in this file is published the moment
    it is committed, and these accounts live on an internet-facing backend.
    """
    password = os.getenv("SEED_PASSWORD", "")
    if not password:
        raise SystemExit(
            "SEED_PASSWORD is not set, and there is no default — this file is public.\n"
            "Generate one with:\n"
            '  python -c "import secrets; print(secrets.token_urlsafe(18))"'
        )
    if len(password) < MIN_PASSWORD_LENGTH:
        raise SystemExit(
            f"SEED_PASSWORD must be at least {MIN_PASSWORD_LENGTH} characters "
            "— the API rejects anything shorter, so these accounts could not log in."
        )
    return password


SEED_PROFILES = [
    {
        "name": "Sarah Chen", "email": "sarah.chen@demo.com",
        "country": "United States", "city": "San Francisco", "age": 28,
        "languages": ["English", "Mandarin"], "profession": "developer",
        "skills": ["React", "Node.js", "Python", "AI/ML", "System Design"],
        "experience": "senior", "availability": "full_time", "budget": "€20,000",
        "objectives": ["SaaS", "AI", "Fintech"],
        "work_style": ["remote", "fast_paced"], "values": ["fast_growth", "impact"],
        "bio": "Ex-Google engineer building the future of AI-powered tools. Looking for a business-minded cofounder to scale a B2B SaaS.",
        "photo": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?crop=entropy&cs=srgb&fm=jpg&w=400&h=500&fit=crop"
    },
    {
        "name": "Marcus Reid", "email": "marcus.reid@demo.com",
        "country": "United Kingdom", "city": "London", "age": 32,
        "languages": ["English", "French"], "profession": "sales",
        "skills": ["B2B Sales", "Enterprise Deals", "Growth", "Fundraising"],
        "experience": "sold_company", "availability": "full_time", "budget": "€50,000+",
        "objectives": ["SaaS", "Fintech", "Marketplace"],
        "work_style": ["hybrid", "fast_paced"], "values": ["raise_funds", "fast_growth"],
        "bio": "Serial entrepreneur. Sold my last SaaS for €12M. Now looking for a technical cofounder to build the next big thing in B2B AI.",
        "photo": "https://images.unsplash.com/photo-1560250097-0b93528c311a?crop=entropy&cs=srgb&fm=jpg&w=400&h=500&fit=crop"
    },
    {
        "name": "Elena Rossi", "email": "elena.rossi@demo.com",
        "country": "Italy", "city": "Milan", "age": 26,
        "languages": ["Italian", "English", "Spanish"], "profession": "designer",
        "skills": ["UI/UX", "Figma", "Design Systems", "Branding", "Motion"],
        "experience": "confirmed", "availability": "full_time", "budget": "Bootstrap only",
        "objectives": ["Mobile app", "SaaS", "Brand"],
        "work_style": ["remote", "methodical"], "values": ["bootstrap", "impact"],
        "bio": "Product designer obsessed with pixel-perfect interfaces. Previously at Nothing and Superhuman. Ready to build a consumer app from scratch.",
        "photo": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?crop=entropy&cs=srgb&fm=jpg&w=400&h=500&fit=crop"
    },
    {
        "name": "David Kim", "email": "david.kim@demo.com",
        "country": "South Korea", "city": "Seoul", "age": 30,
        "languages": ["Korean", "English"], "profession": "product_manager",
        "skills": ["Product Strategy", "Analytics", "Growth", "A/B Testing"],
        "experience": "senior", "availability": "20h_week", "budget": "€5,000",
        "objectives": ["SaaS", "Marketplace", "AI"],
        "work_style": ["hybrid", "methodical"], "values": ["profitability", "family"],
        "bio": "PM at a unicorn startup, side-project ready. Looking for a technical partner to co-build a niche B2B tool with real revenue potential.",
        "photo": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?crop=entropy&cs=srgb&fm=jpg&w=400&h=500&fit=crop"
    },
    {
        "name": "Aisha Patel", "email": "aisha.patel@demo.com",
        "country": "Canada", "city": "Toronto", "age": 29,
        "languages": ["English", "Hindi"], "profession": "marketer",
        "skills": ["Growth Marketing", "SEO", "Content", "Meta Ads", "Google Ads"],
        "experience": "senior", "availability": "full_time", "budget": "€5,000",
        "objectives": ["SaaS", "AI", "Health"],
        "work_style": ["remote", "fast_paced"], "values": ["fast_growth", "impact"],
        "bio": "Scaled 3 SaaS from 0 to €5M ARR through growth marketing. Seeking a builder to launch our next venture in AI + healthcare.",
        "photo": "https://images.unsplash.com/photo-1580489944761-15a19d654956?crop=entropy&cs=srgb&fm=jpg&w=400&h=500&fit=crop"
    },
    {
        "name": "Thomas Weber", "email": "thomas.weber@demo.com",
        "country": "Germany", "city": "Berlin", "age": 34,
        "languages": ["German", "English"], "profession": "finance",
        "skills": ["Financial Modeling", "Fundraising", "M&A", "Corporate Finance"],
        "experience": "raised_funds", "availability": "20h_week", "budget": "€50,000+",
        "objectives": ["Fintech", "SaaS", "Marketplace"],
        "work_style": ["hybrid", "methodical"], "values": ["raise_funds", "profitability"],
        "bio": "Ex-Goldman Sachs, raised €40M for 3 startups. Looking for a technical cofounder for a fintech play in embedded finance.",
        "photo": "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?crop=entropy&cs=srgb&fm=jpg&w=400&h=500&fit=crop"
    },
    {
        "name": "Sofia Martins", "email": "sofia.martins@demo.com",
        "country": "Portugal", "city": "Lisbon", "age": 27,
        "languages": ["Portuguese", "English", "Spanish"], "profession": "content_creator",
        "skills": ["TikTok", "Instagram", "Video Editing", "Community Building"],
        "experience": "confirmed", "availability": "evenings", "budget": "Bootstrap only",
        "objectives": ["Brand", "Marketplace", "Food"],
        "work_style": ["remote", "evening_work"], "values": ["nomad", "impact"],
        "bio": "300K+ followers across platforms. Building a personal brand and looking for a builder to turn my audience into a real product.",
        "photo": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?crop=entropy&cs=srgb&fm=jpg&w=400&h=500&fit=crop"
    },
    {
        "name": "James Okoye", "email": "james.okoye@demo.com",
        "country": "Nigeria", "city": "Lagos", "age": 31,
        "languages": ["English", "Yoruba"], "profession": "developer",
        "skills": ["Flutter", "Swift", "Backend", "AWS", "Blockchain"],
        "experience": "multiple_startups", "availability": "full_time", "budget": "€1,000",
        "objectives": ["Mobile app", "Fintech", "Crypto"],
        "work_style": ["remote", "fast_paced"], "values": ["bootstrap", "impact"],
        "bio": "Founded 2 startups in African fintech. Deep expertise in mobile-first products for emerging markets. Ready for the next big challenge.",
        "photo": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?crop=entropy&cs=srgb&fm=jpg&w=400&h=500&fit=crop"
    },
]


async def seed():
    password = seed_password()
    print("Seeding demo profiles...")
    for p in SEED_PROFILES:
        existing = await users_collection.find_one({"email": p["email"]})
        if existing:
            # Rotate rather than skip. Re-running this against a deployment whose
            # password has leaked is the only way to replace it, and skipping made
            # that impossible without editing the database by hand.
            await users_collection.update_one(
                {"email": p["email"]},
                {"$set": {
                    "password_hash": get_password_hash(password),
                    "updated_at": get_utc_now(),
                }},
            )
            print(f"  Rotated password for {p['name']}")
            continue

        user_id = await generate_user_id()
        new_user = {
            "user_id": user_id,
            "email": p["email"],
            "password_hash": get_password_hash(password),
            "profile": {
                "name": p["name"],
                "photos": [p["photo"]],
                "country": p["country"],
                "city": p["city"],
                "languages": p["languages"],
                "age": p["age"],
                "bio": p["bio"],
                "profession": p["profession"],
                "skills": p["skills"],
                "experience": p["experience"],
                "availability": p["availability"],
                "budget": p["budget"],
                "objectives": p["objectives"],
                "personality": None,
                "work_style": p["work_style"],
                "values": p["values"]
            },
            "verification": {
                "email_verified": True,
                "linkedin_verified": True,
                "github_verified": p["profession"] == "developer",
                "portfolio_verified": p["profession"] == "designer",
                "identity_verified": False
            },
            "gamification": {
                "level": 3,
                "projects_count": 2,
                "startups_created": 1 if p["experience"] in ["sold_company", "raised_funds", "multiple_startups"] else 0,
                "recommendations_count": 5,
                "badges": ["verified", "active"]
            },
            "settings": {
                "notifications_enabled": True,
                "distance_preference": 100,
                "show_age": True
            },
            "premium": False,
            "onboarding_completed": True,
            "created_at": get_utc_now(),
            "updated_at": get_utc_now(),
            "last_active": get_utc_now()
        }
        await users_collection.insert_one(new_user)
        print(f"  Created {p['name']}")
    
    total = await users_collection.count_documents({"onboarding_completed": True})
    print(f"\nTotal complete profiles: {total}")


if __name__ == "__main__":
    asyncio.run(seed())
