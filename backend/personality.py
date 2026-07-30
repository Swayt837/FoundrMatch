"""
Founder personality assessment.

The PRD asks for a personality assessment feeding the compatibility score, and
`profile.personality` has existed in the model since the first commit while never
being written to. This module is what fills it.

Design constraints that shaped it:

- **Deterministic and local.** Scoring an assessment is arithmetic, not an LLM call.
  A questionnaire answered once per user must not cost anything to re-score when the
  weights change.
- **Traits, not a type.** The output is five 0-100 trait values, so the compatibility
  engine can treat each one on its own terms. Reducing a founder to one of sixteen
  letter codes throws away exactly the gradations that matter here.
- **Similarity for some traits, complementarity for others.** Two founders who
  disagree about risk or pace fight constantly; two founders who are both
  product-obsessed and neither market-facing have a different, quieter problem. So
  `orientation` rewards difference while the rest reward alignment. That asymmetry is
  the whole point of scoring traits rather than a distance in trait space.

Answers are a 1-5 Likert scale. Each question loads one trait, positively or
negatively (`direction`), so agreeing with "I'd rather ship and learn" and disagreeing
with "I'd rather plan thoroughly first" both raise `pace`.
"""
from statistics import mean
from typing import Any, Dict, List, Optional

# Answers are 1 (strongly disagree) .. 5 (strongly agree).
MIN_ANSWER = 1
MAX_ANSWER = 5

TRAITS = {
    "risk_appetite": {
        "label": "Risk appetite",
        "low": "Prefers a de-risked path",
        "high": "Comfortable betting big",
        # Two founders with different tolerance for risk disagree about every
        # important decision, so alignment is what scores.
        "compare": "similarity",
        "weight": 0.25,
    },
    "pace": {
        "label": "Pace",
        "low": "Methodical",
        "high": "Ships fast",
        "compare": "similarity",
        "weight": 0.20,
    },
    "structure": {
        "label": "Structure",
        "low": "Improvises",
        "high": "Wants process",
        "compare": "similarity",
        "weight": 0.20,
    },
    "directness": {
        "label": "Directness",
        "low": "Diplomatic",
        "high": "Says it straight",
        # Not about being nice: two conflict-avoidant founders let resentment
        # accumulate instead of resolving it.
        "compare": "similarity",
        "weight": 0.15,
    },
    "orientation": {
        "label": "Orientation",
        "low": "Builder — product and craft",
        "high": "Market-facing — customers and deals",
        # The one trait where difference is the asset.
        "compare": "complementarity",
        "weight": 0.20,
    },
}

# Two questions per trait, one loading each way, so acquiescence bias (a tendency
# to agree with whatever is asked) cancels out instead of skewing the trait.
QUESTIONS: List[Dict[str, Any]] = [
    {
        "id": "risk_1",
        "trait": "risk_appetite",
        "direction": 1,
        "text": "I would leave a stable salary behind for an idea I believe in.",
    },
    {
        "id": "risk_2",
        "trait": "risk_appetite",
        "direction": -1,
        "text": "I want proof a market exists before committing serious time to it.",
    },
    {
        "id": "pace_1",
        "trait": "pace",
        "direction": 1,
        "text": "Shipping something rough this week beats shipping something polished next month.",
    },
    {
        "id": "pace_2",
        "trait": "pace",
        "direction": -1,
        "text": "I would rather think a problem through fully than start and course-correct.",
    },
    {
        "id": "structure_1",
        "trait": "structure",
        "direction": 1,
        "text": "Clear roles, written decisions and regular check-ins make a team faster.",
    },
    {
        "id": "structure_2",
        "trait": "structure",
        "direction": -1,
        "text": "Process slows small teams down; I would rather stay loose and adapt.",
    },
    {
        "id": "direct_1",
        "trait": "directness",
        "direction": 1,
        "text": "When I disagree with a cofounder, I say so immediately and plainly.",
    },
    {
        "id": "direct_2",
        "trait": "directness",
        "direction": -1,
        "text": "I would rather let a small disagreement pass than risk friction over it.",
    },
    {
        "id": "orient_1",
        "trait": "orientation",
        "direction": 1,
        "text": "I get more energy from talking to customers than from building the product.",
    },
    {
        "id": "orient_2",
        "trait": "orientation",
        "direction": -1,
        "text": "Given a free week, I would spend it improving the product, not selling it.",
    },
]

QUESTION_BY_ID = {question["id"]: question for question in QUESTIONS}

# Below this many answered questions the result is noise, so it is refused rather
# than stored as though it meant something.
MIN_ANSWERS_PER_TRAIT = 1

NEUTRAL = 0.5


def _to_unit(answer: int, direction: int) -> float:
    """Map a 1-5 answer onto 0..1, flipping it for negatively-keyed questions."""
    span = MAX_ANSWER - MIN_ANSWER
    unit = (answer - MIN_ANSWER) / span
    return unit if direction > 0 else 1 - unit


def validate_answers(answers: Dict[str, Any]) -> Dict[str, int]:
    """
    Keep only well-formed answers to known questions.

    Raises `ValueError` when a value is present but unusable, rather than silently
    coercing it — a scale answer of 7 or "yes" means the client is broken, and
    quietly clamping it would hide that while corrupting the trait.
    """
    cleaned: Dict[str, int] = {}
    for question_id, value in (answers or {}).items():
        if question_id not in QUESTION_BY_ID:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"Answer for '{question_id}' must be a number from 1 to 5")
        if int(value) != value or not (MIN_ANSWER <= value <= MAX_ANSWER):
            raise ValueError(f"Answer for '{question_id}' must be a whole number from 1 to 5")
        cleaned[question_id] = int(value)
    return cleaned


def score_answers(answers: Dict[str, Any]) -> Dict[str, Any]:
    """
    Turn raw answers into trait values.

    Returns `{"traits": {name: 0-100}, "answers": {...}, "completeness": 0-1}`. A
    trait with no answers is left out entirely rather than defaulted to the midpoint,
    so the comparison can tell "balanced" apart from "unknown".
    """
    cleaned = validate_answers(answers)
    if not cleaned:
        raise ValueError("No valid answers submitted")

    per_trait: Dict[str, List[float]] = {}
    for question_id, answer in cleaned.items():
        question = QUESTION_BY_ID[question_id]
        per_trait.setdefault(question["trait"], []).append(
            _to_unit(answer, question["direction"])
        )

    traits = {
        trait: round(100 * mean(values), 1)
        for trait, values in per_trait.items()
        if len(values) >= MIN_ANSWERS_PER_TRAIT
    }

    return {
        "traits": traits,
        "answers": cleaned,
        "completeness": round(len(cleaned) / len(QUESTIONS), 2),
    }


def traits_of(profile: Optional[Dict[str, Any]]) -> Dict[str, float]:
    """Read the trait map off a profile, tolerating every shape it has ever had."""
    personality = (profile or {}).get("personality")
    if not isinstance(personality, dict):
        return {}
    traits = personality.get("traits")
    if not isinstance(traits, dict):
        return {}
    return {
        name: float(value)
        for name, value in traits.items()
        if name in TRAITS and isinstance(value, (int, float)) and not isinstance(value, bool)
    }


def alignment(traits1: Dict[str, float], traits2: Dict[str, float]) -> Optional[float]:
    """
    How well two trait maps fit, in 0..1. `None` when there is nothing to compare.

    Only traits both founders answered contribute, and the weights are renormalised
    over those — a half-finished assessment gives a weaker signal, not a wrong one.
    """
    shared = [name for name in TRAITS if name in traits1 and name in traits2]
    if not shared:
        return None

    total_weight = sum(TRAITS[name]["weight"] for name in shared)
    score = 0.0
    for name in shared:
        distance = abs(traits1[name] - traits2[name]) / 100
        fit = distance if TRAITS[name]["compare"] == "complementarity" else 1 - distance
        score += TRAITS[name]["weight"] * fit

    return score / total_weight


def describe(traits: Dict[str, float]) -> List[Dict[str, Any]]:
    """Traits as a labelled list for the UI, in questionnaire order."""
    return [
        {
            "key": name,
            "label": meta["label"],
            "low": meta["low"],
            "high": meta["high"],
            "value": traits.get(name),
        }
        for name, meta in TRAITS.items()
        if name in traits
    ]


def public_questions() -> List[Dict[str, Any]]:
    """
    The questionnaire as the client needs it.

    `direction` is deliberately withheld: telling the user which way a question is
    keyed invites answering to a desired result.
    """
    return [
        {"id": q["id"], "trait": q["trait"], "text": q["text"]}
        for q in QUESTIONS
    ]
