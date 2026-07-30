"""
Personality assessment tests.

Pure arithmetic — no database, no LLM key, no deployed backend.

The properties that matter: reversed questions must cancel acquiescence bias,
partial assessments must still produce a usable signal, and `orientation` must
reward difference while every other trait rewards similarity. That asymmetry is the
reason traits are compared one by one instead of as a distance in trait space, so a
regression there is a silent product change.

Run with: pytest backend/tests -o addopts=''
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import personality  # noqa: E402


def answers_for(**traits: int) -> dict:
    """
    Build a full answer sheet where each named trait sits at the given 1-5 level.

    Reverse-keyed questions are mirrored, so `pace=5` means "maximally fast" rather
    than "agreed with both questions".
    """
    sheet = {}
    for question in personality.QUESTIONS:
        level = traits.get(question["trait"], 3)
        sheet[question["id"]] = level if question["direction"] > 0 else 6 - level
    return sheet


class TestScoring:
    def test_extreme_answers_reach_the_ends_of_the_scale(self):
        high = personality.score_answers(answers_for(pace=5))["traits"]
        low = personality.score_answers(answers_for(pace=1))["traits"]

        assert high["pace"] == 100
        assert low["pace"] == 0

    def test_reversed_questions_cancel_a_tendency_to_agree(self):
        """
        Someone who agrees with everything should land in the middle of every trait,
        not at the top — that is the entire point of keying half the questions the
        other way.
        """
        agree_with_all = {question["id"]: 5 for question in personality.QUESTIONS}

        traits = personality.score_answers(agree_with_all)["traits"]

        assert set(traits) == set(personality.TRAITS)
        assert all(value == 50 for value in traits.values()), traits

    def test_every_trait_is_covered_by_the_questionnaire(self):
        covered = {question["trait"] for question in personality.QUESTIONS}
        assert covered == set(personality.TRAITS)

    def test_trait_weights_sum_to_one(self):
        total = sum(meta["weight"] for meta in personality.TRAITS.values())
        assert abs(total - 1.0) < 1e-9

    def test_partial_submission_scores_only_what_was_answered(self):
        result = personality.score_answers({"pace_1": 5})

        assert result["traits"] == {"pace": 100}
        assert result["completeness"] == round(1 / len(personality.QUESTIONS), 2)

    def test_unknown_questions_are_ignored(self):
        result = personality.score_answers({"pace_1": 5, "not_a_question": 5})

        assert set(result["answers"]) == {"pace_1"}

    @pytest.mark.parametrize("value", [0, 6, 2.5, "3", True, None])
    def test_out_of_range_answers_are_rejected_not_clamped(self, value):
        """A 7 or a "yes" means the client is broken; clamping would hide that."""
        with pytest.raises(ValueError):
            personality.score_answers({"pace_1": value})

    def test_empty_submission_is_rejected(self):
        with pytest.raises(ValueError):
            personality.score_answers({})


class TestAlignment:
    def test_identical_founders_align_on_similarity_traits(self):
        traits = {"risk_appetite": 80.0, "pace": 70.0}

        assert personality.alignment(traits, traits) == 1.0

    def test_opposite_risk_appetites_score_zero(self):
        assert personality.alignment({"risk_appetite": 0.0}, {"risk_appetite": 100.0}) == 0.0

    def test_orientation_rewards_difference(self):
        """A builder paired with a seller is the shape cofounder matching wants."""
        complementary = personality.alignment({"orientation": 0.0}, {"orientation": 100.0})
        identical = personality.alignment({"orientation": 50.0}, {"orientation": 50.0})

        assert complementary == 1.0
        assert identical == 0.0

    def test_alignment_is_symmetric(self):
        a = {"risk_appetite": 20.0, "orientation": 90.0, "pace": 55.0}
        b = {"risk_appetite": 75.0, "orientation": 10.0, "pace": 40.0}

        assert personality.alignment(a, b) == personality.alignment(b, a)

    def test_no_shared_traits_is_unknown_rather_than_zero(self):
        assert personality.alignment({"pace": 50.0}, {"risk_appetite": 50.0}) is None
        assert personality.alignment({}, {}) is None

    def test_weights_renormalise_over_shared_traits(self):
        """
        A pair who only overlap on one trait, and match on it, scores 1.0 — the
        signal is weaker (fewer traits) but not wrong (not diluted toward 0).
        """
        assert personality.alignment(
            {"pace": 60.0, "structure": 10.0},
            {"pace": 60.0},
        ) == 1.0


class TestTraitsOf:
    def test_reads_traits_off_a_scored_profile(self):
        scored = personality.score_answers(answers_for(pace=5))
        profile = {"personality": scored}

        assert personality.traits_of(profile)["pace"] == 100

    @pytest.mark.parametrize(
        "profile",
        [
            None,
            {},
            {"personality": None},
            {"personality": "extrovert"},
            {"personality": {"traits": None}},
            {"personality": {"traits": []}},
        ],
    )
    def test_tolerates_every_shape_the_field_has_ever_had(self, profile):
        """`profile.personality` was `None` for every user created before this."""
        assert personality.traits_of(profile) == {}

    def test_drops_unknown_and_non_numeric_traits(self):
        traits = personality.traits_of(
            {"personality": {"traits": {"pace": 40, "vibes": 90, "structure": "high"}}}
        )

        assert traits == {"pace": 40.0}


class TestQuestionnaireExposure:
    def test_direction_is_not_exposed_to_the_client(self):
        """Revealing which way a question is keyed invites gaming the result."""
        for question in personality.public_questions():
            assert set(question) == {"id", "trait", "text"}


class TestCompatibilityIntegration:
    """The assessment has to actually move the compatibility score."""

    def _profile(self, **overrides):
        base = {
            "profession": "developer",
            "skills": ["React", "Python"],
            "experience": "senior",
            "availability": "full_time",
            "objectives": ["fast_growth"],
            "values": ["transparency"],
            "work_style": ["remote"],
        }
        base.update(overrides)
        return base

    def test_aligned_assessments_beat_opposed_ones(self):
        from compatibility import score_compatibility

        bold = personality.score_answers(answers_for(risk_appetite=5, pace=5))
        cautious = personality.score_answers(answers_for(risk_appetite=1, pace=1))

        aligned = score_compatibility(
            self._profile(personality=bold),
            self._profile(personality=bold),
        )["personality_score"]
        opposed = score_compatibility(
            self._profile(personality=bold),
            self._profile(personality=cautious),
        )["personality_score"]

        assert aligned > opposed

    def test_falls_back_to_seniority_when_the_assessment_is_missing(self):
        """Users who never took it must still be scored, not zeroed."""
        from compatibility import score_compatibility

        score = score_compatibility(self._profile(), self._profile())["personality_score"]

        assert score > 0

    def test_one_sided_assessment_uses_the_fallback(self):
        from compatibility import score_compatibility

        taken = personality.score_answers(answers_for(risk_appetite=5))

        with_one = score_compatibility(
            self._profile(personality=taken),
            self._profile(),
        )["personality_score"]
        with_none = score_compatibility(self._profile(), self._profile())["personality_score"]

        assert with_one == with_none
