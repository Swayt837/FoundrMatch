"""
Compatibility engine tests: JSON extraction and the heuristic fallback.

Both live in `compatibility.py` with no third-party imports, so these run
anywhere — no database, no LLM key, no deployed backend.

Run with: pytest backend/tests -o addopts=''
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from compatibility import (  # noqa: E402
    DIMENSION_WEIGHTS,
    extract_json,
    heuristic_compatibility,
)

DIMENSIONS = (
    "skills_score", "vision_score", "availability_score",
    "personality_score", "objectives_score", "work_style_score",
)

DEVELOPER = {
    "profession": "developer",
    "skills": ["React", "Node.js", "Python"],
    "objectives": ["SaaS", "AI"],
    "values": ["fast_growth", "impact"],
    "work_style": ["remote", "fast_paced"],
    "availability": "full_time",
}
DESIGNER = {
    "profession": "designer",
    "skills": ["Figma", "UI/UX", "Branding"],
    "objectives": ["SaaS", "AI"],
    "values": ["fast_growth", "impact"],
    "work_style": ["remote", "fast_paced"],
    "availability": "full_time",
}


class TestHeuristicCompatibility:
    def test_scores_stay_in_range(self):
        result = heuristic_compatibility(DEVELOPER, DESIGNER)
        for dimension in (*DIMENSIONS, "overall_score"):
            assert 0 <= result[dimension] <= 100, dimension

    def test_result_is_labelled_as_an_estimate(self):
        result = heuristic_compatibility(DEVELOPER, DESIGNER)
        # The UI keys off this to show "est." rather than passing a fallback off
        # as a real AI verdict — the old code returned a flat 74% unlabelled.
        assert result["source"] == "heuristic"
        assert result["explanation"]

    def test_complementary_pair_beats_identical_pair(self):
        complementary = heuristic_compatibility(DEVELOPER, DESIGNER)["skills_score"]
        identical = heuristic_compatibility(DEVELOPER, DEVELOPER)["skills_score"]
        assert complementary > identical

    def test_shared_objectives_beat_disjoint_ones(self):
        aligned = heuristic_compatibility(DEVELOPER, DESIGNER)["objectives_score"]
        diverging = heuristic_compatibility(
            DEVELOPER, {**DESIGNER, "objectives": ["agency", "ecommerce"]}
        )["objectives_score"]
        assert aligned > diverging

    def test_matching_availability_beats_mismatched(self):
        same = heuristic_compatibility(DEVELOPER, DESIGNER)["availability_score"]
        different = heuristic_compatibility(
            DEVELOPER, {**DESIGNER, "availability": "weekends"}
        )["availability_score"]
        assert same > different

    def test_shared_work_style_beats_opposed(self):
        same = heuristic_compatibility(DEVELOPER, DESIGNER)["work_style_score"]
        different = heuristic_compatibility(
            DEVELOPER, {**DESIGNER, "work_style": ["in_person", "methodical"]}
        )["work_style_score"]
        assert same > different

    def test_overall_is_the_weighted_mean_of_the_dimensions(self):
        result = heuristic_compatibility(DEVELOPER, DESIGNER)
        expected = sum(result[dim] * weight for dim, weight in DIMENSION_WEIGHTS.items())
        assert result["overall_score"] == pytest.approx(expected, abs=0.1)

    def test_shared_objectives_appear_in_the_explanation(self):
        assert "saas" in heuristic_compatibility(DEVELOPER, DESIGNER)["explanation"].lower()

    def test_empty_profiles_do_not_crash(self):
        result = heuristic_compatibility({}, {})
        assert 0 <= result["overall_score"] <= 100

    def test_unknown_availability_falls_back_to_neutral(self):
        result = heuristic_compatibility(
            {**DEVELOPER, "availability": "whenever"}, DESIGNER
        )
        assert result["availability_score"] == 60.0

    def test_case_and_whitespace_insensitive(self):
        messy = {**DESIGNER, "objectives": ["  saas ", "AI"]}
        assert (
            heuristic_compatibility(DEVELOPER, messy)["objectives_score"]
            == heuristic_compatibility(DEVELOPER, DESIGNER)["objectives_score"]
        )

    def test_is_symmetric(self):
        forward = heuristic_compatibility(DEVELOPER, DESIGNER)
        backward = heuristic_compatibility(DESIGNER, DEVELOPER)
        assert forward["overall_score"] == backward["overall_score"]

    def test_is_deterministic(self):
        assert heuristic_compatibility(DEVELOPER, DESIGNER) == heuristic_compatibility(
            DEVELOPER, DESIGNER
        )


class TestExtractJson:
    def test_plain_object(self):
        assert extract_json('{"a": 1}') == {"a": 1}

    def test_fenced_block(self):
        assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}

    def test_unterminated_fence(self):
        # The old first-and-last-line slicing corrupted this case
        assert extract_json('```json\n{"a": 1}') == {"a": 1}

    def test_prose_around_payload(self):
        assert extract_json('Sure! Here you go:\n{"a": 1}\nHope that helps.') == {"a": 1}

    def test_bare_array(self):
        assert extract_json('[{"title": "X"}]') == [{"title": "X"}]

    def test_fenced_array(self):
        assert extract_json('```\n[{"title": "X"}]\n```') == [{"title": "X"}]

    def test_no_json_raises(self):
        with pytest.raises(ValueError):
            extract_json("I cannot help with that.")

    def test_empty_input_raises(self):
        with pytest.raises(ValueError):
            extract_json("")
