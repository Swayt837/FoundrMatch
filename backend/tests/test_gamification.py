"""
Gamification level and badge maths.

Only the pure functions are covered here — `award()` needs a database, so it is
exercised by the API-level suites.

Run with: pytest backend/tests -o addopts=''
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

pytest.importorskip("motor", reason="gamification imports the Mongo client module")

from gamification import (  # noqa: E402
    BADGE_RULES,
    COUNTER_POINTS,
    LEVEL_THRESHOLDS,
    _earned_badges,
    _points,
    level_for_points,
)


class TestLevels:
    def test_starts_at_level_one(self):
        assert level_for_points(0) == 1

    def test_level_increases_at_each_threshold(self):
        for index, threshold in enumerate(LEVEL_THRESHOLDS):
            assert level_for_points(threshold) == index + 1

    def test_level_is_monotonic(self):
        levels = [level_for_points(points) for points in range(0, 300, 7)]
        assert levels == sorted(levels)

    def test_level_caps_at_the_top_threshold(self):
        assert level_for_points(10_000) == len(LEVEL_THRESHOLDS)


class TestPoints:
    def test_empty_profile_scores_zero(self):
        assert _points({}) == 0

    def test_counters_are_weighted(self):
        # A created startup is worth more than a posted project
        assert _points({"startups_created": 1}) > _points({"projects_count": 1})

    def test_counters_accumulate(self):
        assert _points({"projects_count": 2, "matches_count": 3}) == (
            2 * COUNTER_POINTS["projects_count"] + 3 * COUNTER_POINTS["matches_count"]
        )

    def test_ignores_unknown_and_null_counters(self):
        assert _points({"projects_count": None, "unknown_counter": 99}) == 0


class TestBadges:
    def test_no_badges_at_zero(self):
        assert _earned_badges({}) == []

    def test_first_match_badge_is_awarded(self):
        assert "first_match" in _earned_badges({"matches_count": 1})

    def test_badges_stack_as_counters_grow(self):
        few = _earned_badges({"matches_count": 1})
        many = _earned_badges({"matches_count": 10})
        assert set(few).issubset(set(many))
        assert "connector" in many

    def test_every_rule_references_a_real_counter(self):
        for _key, counter, _threshold, _label in BADGE_RULES:
            assert counter in COUNTER_POINTS

    def test_badge_keys_are_unique(self):
        keys = [rule[0] for rule in BADGE_RULES]
        assert len(keys) == len(set(keys))
