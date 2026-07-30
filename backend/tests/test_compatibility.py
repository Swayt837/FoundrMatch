"""
Compatibility engine tests.

The engine is deterministic and dependency-free, so these run anywhere — no
database, no LLM key, no deployed backend.

The important test in here is `TestScoreSpread`: the whole reason for replacing
LLM-per-pair scoring was that asking a model to rate compatibility returns 85-98%
for almost any pair, which cannot rank anything. If these spread assertions start
failing, the engine has regressed to a decorative score.

Run with: pytest backend/tests -o addopts=''
"""
import os
import statistics
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from compatibility import (  # noqa: E402
    DIMENSION_WEIGHTS,
    dimension_breakdown,
    score_compatibility,
)

DIMENSIONS = tuple(DIMENSION_WEIGHTS)

# The archetypal good pairing: technical + commercial, same goals, same commitment.
DEVELOPER = {
    "profession": "developer",
    "skills": ["React", "Node.js", "PostgreSQL"],
    "experience": "senior",
    "objectives": ["SaaS", "AI"],
    "values": ["fast_growth", "impact"],
    "work_style": ["remote", "fast_paced"],
    "availability": "full_time",
}
DESIGNER = {
    "profession": "designer",
    "skills": ["Figma", "UI/UX", "Branding"],
    "experience": "senior",
    "objectives": ["SaaS", "AI"],
    "values": ["fast_growth", "impact"],
    "work_style": ["remote", "fast_paced"],
    "availability": "full_time",
}

# A realistic spread of founders, used for the distribution tests.
POPULATION = [
    DEVELOPER,
    DESIGNER,
    {
        "profession": "sales",
        "skills": ["B2B Sales", "Enterprise Deals", "Fundraising"],
        "experience": "sold_company",
        "objectives": ["SaaS", "Fintech"],
        "values": ["raise_funds", "fast_growth"],
        "work_style": ["hybrid", "fast_paced"],
        "availability": "full_time",
    },
    {
        "profession": "developer",
        "skills": ["Python", "Django", "AWS"],
        "experience": "junior",
        "objectives": ["agency"],
        "values": ["bootstrap", "family"],
        "work_style": ["in_person", "methodical"],
        "availability": "weekends",
    },
    {
        "profession": "marketer",
        "skills": ["SEO", "Google Ads", "Content"],
        "experience": "confirmed",
        "objectives": ["ecommerce", "SaaS"],
        "values": ["bootstrap", "profitability"],
        "work_style": ["remote", "methodical"],
        "availability": "20h_week",
    },
    {
        "profession": "product_manager",
        "skills": ["Roadmapping", "User Research", "Analytics"],
        "experience": "senior",
        "objectives": ["mobile app", "AI"],
        "values": ["impact", "fast_growth"],
        "work_style": ["remote", "fast_paced"],
        "availability": "10h_week",
    },
    {
        "profession": "finance",
        "skills": ["Financial Modeling", "Fundraising"],
        "experience": "multiple_startups",
        "objectives": ["Fintech"],
        "values": ["raise_funds", "profitability"],
        "work_style": ["in_person", "methodical"],
        "availability": "evenings",
    },
]


def _all_pair_scores():
    return [
        score_compatibility(a, b)["overall_score"]
        for i, a in enumerate(POPULATION)
        for b in POPULATION[i + 1:]
    ]


class TestScoreSpread:
    """The acceptance criterion for replacing the LLM scorer."""

    def test_scores_are_not_bunched_at_the_top(self):
        scores = _all_pair_scores()
        # The LLM scorer produced 85-98 for everything. Anything under ~10 points
        # of standard deviation cannot meaningfully order a feed.
        assert statistics.stdev(scores) >= 10, f"scores too bunched: {sorted(scores)}"

    def test_scores_span_a_wide_band(self):
        scores = _all_pair_scores()
        assert max(scores) - min(scores) >= 30, f"range too narrow: {sorted(scores)}"

    def test_best_pair_clearly_beats_worst(self):
        scores = _all_pair_scores()
        assert max(scores) - min(scores) >= 25
        assert max(scores) > 70
        assert min(scores) < 55

    def test_no_score_leaves_the_valid_range(self):
        for score in _all_pair_scores():
            assert 0 <= score <= 100

    def test_ideal_pair_scores_high(self):
        assert score_compatibility(DEVELOPER, DESIGNER)["overall_score"] >= 75

    def test_poor_pair_scores_low(self):
        # Same domain, opposed goals and values, incompatible commitment.
        clone = {
            **DEVELOPER,
            "objectives": ["agency"],
            "values": ["bootstrap", "family"],
            "work_style": ["in_person", "methodical"],
            "availability": "weekends",
            "experience": "beginner",
        }
        assert score_compatibility(DEVELOPER, clone)["overall_score"] <= 45


class TestDimensions:
    def test_all_dimensions_present_and_in_range(self):
        result = score_compatibility(DEVELOPER, DESIGNER)
        for dimension in (*DIMENSIONS, "overall_score"):
            assert 0 <= result[dimension] <= 100, dimension

    def test_overall_is_the_weighted_mean_of_the_dimensions(self):
        result = score_compatibility(DEVELOPER, DESIGNER)
        expected = sum(result[dim] * weight for dim, weight in DIMENSION_WEIGHTS.items())
        assert result["overall_score"] == pytest.approx(expected, abs=0.1)

    def test_weights_sum_to_one(self):
        # Otherwise the overall score cannot span 0-100
        assert sum(DIMENSION_WEIGHTS.values()) == pytest.approx(1.0)

    def test_result_is_labelled_algorithmic(self):
        result = score_compatibility(DEVELOPER, DESIGNER)
        assert result["source"] == "algorithmic"
        assert result["explanation"]

    def test_complementary_pair_beats_identical_pair(self):
        complementary = score_compatibility(DEVELOPER, DESIGNER)["skills_score"]
        identical = score_compatibility(DEVELOPER, DEVELOPER)["skills_score"]
        assert complementary > identical

    def test_skills_use_the_taxonomy_not_raw_strings(self):
        # "Frontend" and "React" are the same ground; a raw-string Jaccard would
        # score them as complementary as a developer and a designer.
        frontend_dev = {**DEVELOPER, "skills": ["Frontend", "JavaScript"]}
        react_dev = {**DEVELOPER, "skills": ["React", "TypeScript"]}
        overlapping = score_compatibility(frontend_dev, react_dev)["skills_score"]
        assert overlapping < score_compatibility(DEVELOPER, DESIGNER)["skills_score"]

    def test_shared_objectives_beat_disjoint_ones(self):
        aligned = score_compatibility(DEVELOPER, DESIGNER)["objectives_score"]
        diverging = score_compatibility(
            DEVELOPER, {**DESIGNER, "objectives": ["agency", "ecommerce"]}
        )["objectives_score"]
        assert aligned > diverging

    def test_matching_availability_beats_mismatched(self):
        same = score_compatibility(DEVELOPER, DESIGNER)["availability_score"]
        different = score_compatibility(
            DEVELOPER, {**DESIGNER, "availability": "weekends"}
        )["availability_score"]
        assert same > different

    def test_availability_is_compared_on_hours_not_labels(self):
        # 10h/week vs weekends (~12h) should be closer than 10h vs full time
        close = score_compatibility(
            {**DEVELOPER, "availability": "10h_week"},
            {**DESIGNER, "availability": "weekends"},
        )["availability_score"]
        far = score_compatibility(
            {**DEVELOPER, "availability": "10h_week"},
            {**DESIGNER, "availability": "full_time"},
        )["availability_score"]
        assert close > far

    def test_shared_values_beat_opposed_values(self):
        same = score_compatibility(DEVELOPER, DESIGNER)["vision_score"]
        opposed = score_compatibility(
            DEVELOPER, {**DESIGNER, "values": ["bootstrap", "family"]}
        )["vision_score"]
        assert same > opposed

    def test_similar_seniority_beats_a_large_gap(self):
        peers = score_compatibility(DEVELOPER, DESIGNER)["personality_score"]
        mismatched = score_compatibility(
            DEVELOPER, {**DESIGNER, "experience": "beginner"}
        )["personality_score"]
        assert peers > mismatched


class TestRobustness:
    def test_empty_profiles_score_neutral_rather_than_zero(self):
        # An incomplete profile is unknown, not incompatible
        result = score_compatibility({}, {})
        assert 40 <= result["overall_score"] <= 60

    def test_empty_profile_does_not_crash_any_dimension(self):
        result = score_compatibility({}, DESIGNER)
        for dimension in (*DIMENSIONS, "overall_score"):
            assert 0 <= result[dimension] <= 100, dimension

    def test_case_and_whitespace_insensitive(self):
        messy = {**DESIGNER, "objectives": ["  saas ", "AI"]}
        assert (
            score_compatibility(DEVELOPER, messy)["objectives_score"]
            == score_compatibility(DEVELOPER, DESIGNER)["objectives_score"]
        )

    def test_is_symmetric(self):
        for i, a in enumerate(POPULATION):
            for b in POPULATION[i + 1:]:
                assert (
                    score_compatibility(a, b)["overall_score"]
                    == score_compatibility(b, a)["overall_score"]
                )

    def test_is_deterministic(self):
        assert score_compatibility(DEVELOPER, DESIGNER) == score_compatibility(
            DEVELOPER, DESIGNER
        )

    def test_none_values_are_tolerated(self):
        sparse = {"profession": None, "skills": None, "objectives": None, "values": None}
        result = score_compatibility(sparse, DESIGNER)
        assert 0 <= result["overall_score"] <= 100


class TestSummary:
    def test_mentions_shared_objectives(self):
        assert "saas" in score_compatibility(DEVELOPER, DESIGNER)["explanation"].lower()

    def test_flags_an_availability_gap(self):
        result = score_compatibility(
            {**DEVELOPER, "availability": "full_time"},
            {**DESIGNER, "availability": "weekends"},
        )
        assert "availability" in result["explanation"].lower()

    def test_empty_profiles_get_an_honest_message(self):
        explanation = score_compatibility({}, {})["explanation"]
        assert "profile" in explanation.lower()


class TestDimensionBreakdown:
    def test_returns_every_dimension_sorted_strongest_first(self):
        scores = score_compatibility(DEVELOPER, DESIGNER)
        breakdown = dimension_breakdown(scores)

        assert {item["key"] for item in breakdown} == set(DIMENSIONS)
        assert [item["score"] for item in breakdown] == sorted(
            (item["score"] for item in breakdown), reverse=True
        )

    def test_every_item_is_labelled_and_weighted(self):
        breakdown = dimension_breakdown(score_compatibility(DEVELOPER, DESIGNER))
        for item in breakdown:
            assert item["label"]
            assert item["weight"] > 0
