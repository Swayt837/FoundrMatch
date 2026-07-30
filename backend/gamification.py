"""
Gamification counters, levels and badges.

The user document has carried `level`, `projects_count`, `startups_created`,
`recommendations_count` and `badges` since the first commit, but nothing ever
incremented them — the profile screen showed zeros forever. These helpers are
called from the endpoints that represent real progress.
"""
from typing import Any, Dict, List, Optional

from database import get_utc_now, users_collection

# Cumulative points needed to reach each level, index = level - 1.
LEVEL_THRESHOLDS = [0, 3, 8, 15, 25, 40, 60, 85, 120, 170]

# Points awarded per tracked counter.
COUNTER_POINTS = {
    "projects_count": 1,
    "startups_created": 3,
    "recommendations_count": 1,
    "matches_count": 1,
}

# badge key -> (counter, threshold, label)
BADGE_RULES = [
    ("first_match", "matches_count", 1, "First Match"),
    ("connector", "matches_count", 10, "Connector"),
    ("first_project", "projects_count", 1, "First Project"),
    ("serial_poster", "projects_count", 5, "Serial Poster"),
    ("builder", "startups_created", 1, "Builder"),
    ("serial_builder", "startups_created", 3, "Serial Builder"),
]


def level_for_points(points: int) -> int:
    """Highest level whose threshold the user has reached."""
    level = 1
    for index, threshold in enumerate(LEVEL_THRESHOLDS):
        if points >= threshold:
            level = index + 1
    return level


def _points(gamification: Dict[str, Any]) -> int:
    return sum(
        int(gamification.get(counter, 0) or 0) * points
        for counter, points in COUNTER_POINTS.items()
    )


def _earned_badges(gamification: Dict[str, Any]) -> List[str]:
    return [
        key
        for key, counter, threshold, _label in BADGE_RULES
        if int(gamification.get(counter, 0) or 0) >= threshold
    ]


async def award(user_id: str, counter: str, amount: int = 1) -> Optional[Dict[str, Any]]:
    """
    Increment a gamification counter, then recompute level and badges.

    Returns the updated gamification block, or None if the user disappeared.
    """
    if counter not in COUNTER_POINTS:
        raise ValueError(f"Unknown gamification counter: {counter}")

    updated = await users_collection.find_one_and_update(
        {"user_id": user_id},
        {"$inc": {f"gamification.{counter}": amount}},
        projection={"_id": 0, "gamification": 1},
        return_document=True,
    )
    if not updated:
        return None

    gamification = updated.get("gamification") or {}
    level = level_for_points(_points(gamification))
    badges = _earned_badges(gamification)

    await users_collection.update_one(
        {"user_id": user_id},
        {"$set": {
            "gamification.level": level,
            "gamification.badges": badges,
            "updated_at": get_utc_now(),
        }},
    )

    return {**gamification, "level": level, "badges": badges}


async def award_many(user_ids: List[str], counter: str, amount: int = 1) -> None:
    """Award the same counter to several users (both sides of a match)."""
    for user_id in user_ids:
        await award(user_id, counter, amount)
