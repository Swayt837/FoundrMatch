"""
Compatibility scoring — deterministic, dependency-free, and the primary engine.

This used to be a fallback behind an LLM call that scored every pair. That design
had three problems the model could not fix: asking Claude to rate compatibility
returns 85-98% for almost any pair (a ranking signal that is always high ranks
nothing), the same pair scored differently on each call, and the overall score was
whatever the model said rather than a function of the six dimensions.

So the number is computed here and the LLM writes *about* it — see
`ai_service.explain_compatibility`. Properties this buys:

- **Deterministic** — same pair, same score, cacheable forever.
- **Spread** — each dimension is defined over the full 0-100 range, so the weighted
  overall uses it too. A mediocre pair genuinely scores low.
- **Tunable** — `DIMENSION_WEIGHTS` can be fitted against real swipe/match/message
  outcomes, which is impossible when the model is the judge.
- **Free and instant** — thousands of candidates can be ranked per request.
"""
import json
import re
from typing import Any, Dict, List, Set

import personality
from skills_taxonomy import concepts_for, domains_for, normalize

# How much each dimension contributes. Every dimension is scored 0-100, so these
# weights must sum to 1.0 for the overall score to span 0-100.
DIMENSION_WEIGHTS = {
    "skills_score": 0.30,
    "objectives_score": 0.20,
    "vision_score": 0.15,
    "availability_score": 0.15,
    "work_style_score": 0.10,
    "personality_score": 0.10,
}

# Weekly hours each availability option implies, for comparing commitment.
AVAILABILITY_HOURS = {
    "full_time": 40,
    "immediate": 40,
    "20h_week": 20,
    "10h_week": 10,
    "evenings": 12,
    "weekends": 12,
}

# Seniority ladder. Founders at a similar level tend to work together as peers;
# a large gap predicts friction over decision-making.
EXPERIENCE_RANK = {
    "beginner": 1,
    "junior": 2,
    "confirmed": 3,
    "senior": 4,
    "sold_company": 5,
    "raised_funds": 5,
    "multiple_startups": 6,
}

# Used when one side has no data: neither aligned nor opposed.
NEUTRAL = 0.5

# Complementary *domains* matter more for cofounders than complementary
# individual skills — a developer and a designer is the shape we're looking for.
_DOMAIN_WEIGHT = 0.6
_CONCEPT_WEIGHT = 0.4

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


# ===== JSON extraction (used by ai_service for LLM responses) =====

def extract_json(text: str) -> Any:
    """
    Pull a JSON value out of a model response.

    Handles bare JSON, fenced blocks, and prose wrapped around the payload. The
    original implementation sliced off the first and last line, which silently
    corrupted any response whose fence was missing or unbalanced.
    """
    cleaned = _FENCE_RE.sub("", (text or "").strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    for opener, closer in (("{", "}"), ("[", "]")):
        start = cleaned.find(opener)
        end = cleaned.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except json.JSONDecodeError:
                continue

    raise ValueError("No JSON object found in model response")


# ===== Set similarity =====

def _normalized_set(values: Any) -> Set[str]:
    """Lower-cased, trimmed set of tag-like values."""
    if not values:
        return set()
    return {normalize(str(v)) for v in values if normalize(str(v))}


def _similarity(a: Set[str], b: Set[str]) -> float:
    """
    Jaccard similarity in 0..1, NEUTRAL when either side is empty.

    Empty means "unknown", not "opposed" — scoring it 0 would punish incomplete
    profiles as though they were incompatible.
    """
    if not a or not b:
        return NEUTRAL
    return len(a & b) / len(a | b)


def _complementarity(a: Set[str], b: Set[str]) -> float:
    """How *different* two sets are, in 0..1. NEUTRAL when either is empty."""
    if not a or not b:
        return NEUTRAL
    return 1 - (len(a & b) / len(a | b))


# ===== Per-dimension scores, each 0-100 =====

def _skills_score(profile1: Dict[str, Any], profile2: Dict[str, Any]) -> float:
    """
    Complementarity of what the two founders can build.

    Measured at two levels: different *domains* (frontend vs sales) is the strong
    signal, non-overlapping *concepts* within a domain is the weaker one. Both are
    resolved through the taxonomy, so "React" and "Frontend" are recognised as the
    same ground rather than two unrelated skills.
    """
    domains1 = domains_for(profile1.get("skills"), profile1.get("profession") or "")
    domains2 = domains_for(profile2.get("skills"), profile2.get("profession") or "")
    concepts1 = concepts_for(profile1.get("skills"))
    concepts2 = concepts_for(profile2.get("skills"))

    domain_part = _complementarity(domains1, domains2)
    concept_part = _complementarity(concepts1, concepts2)

    return 100 * (_DOMAIN_WEIGHT * domain_part + _CONCEPT_WEIGHT * concept_part)


def _objectives_score(profile1: Dict[str, Any], profile2: Dict[str, Any]) -> float:
    """Alignment on what they want to build."""
    return 100 * _similarity(
        _normalized_set(profile1.get("objectives")),
        _normalized_set(profile2.get("objectives")),
    )


def _vision_score(profile1: Dict[str, Any], profile2: Dict[str, Any]) -> float:
    """
    Alignment on how they want to build it.

    Values carry more weight than objectives here: two founders can agree on
    building a SaaS and still split over bootstrap-versus-raise.
    """
    values = _similarity(
        _normalized_set(profile1.get("values")),
        _normalized_set(profile2.get("values")),
    )
    objectives = _similarity(
        _normalized_set(profile1.get("objectives")),
        _normalized_set(profile2.get("objectives")),
    )
    return 100 * (0.65 * values + 0.35 * objectives)


def _availability_score(profile1: Dict[str, Any], profile2: Dict[str, Any]) -> float:
    """
    Closeness of weekly commitment.

    A full-time founder paired with a weekends-only one is the classic failure
    mode, so the gap is penalised on committed hours rather than on label equality.
    """
    hours1 = AVAILABILITY_HOURS.get(normalize(str(profile1.get("availability") or "")).replace(" ", "_"))
    hours2 = AVAILABILITY_HOURS.get(normalize(str(profile2.get("availability") or "")).replace(" ", "_"))

    if not hours1 or not hours2:
        return 100 * NEUTRAL

    gap = abs(hours1 - hours2)
    return 100 * max(0.0, 1 - gap / 40)


def _work_style_score(profile1: Dict[str, Any], profile2: Dict[str, Any]) -> float:
    """Shared working habits — remote vs in-person, fast vs methodical."""
    return 100 * _similarity(
        _normalized_set(profile1.get("work_style")),
        _normalized_set(profile2.get("work_style")),
    )


def _personality_score(profile1: Dict[str, Any], profile2: Dict[str, Any]) -> float:
    """
    How well they will get on day to day.

    When both founders have taken the personality assessment, their trait alignment
    is the stronger half of this score — it measures agreement on risk, pace,
    structure and directness, and *disagreement* on builder-versus-seller
    orientation (see `personality.TRAITS`).

    Without it, the fallback is seniority proximity: peers argue better than a
    senior/junior pair. That is a proxy, not a measurement, which is why taking the
    assessment visibly sharpens the score.
    """
    habits = _similarity(
        _normalized_set(profile1.get("work_style")),
        _normalized_set(profile2.get("work_style")),
    )

    traits = personality.alignment(
        personality.traits_of(profile1),
        personality.traits_of(profile2),
    )
    if traits is not None:
        return 100 * (0.65 * traits + 0.35 * habits)

    rank1 = EXPERIENCE_RANK.get(normalize(str(profile1.get("experience") or "")).replace(" ", "_"))
    rank2 = EXPERIENCE_RANK.get(normalize(str(profile2.get("experience") or "")).replace(" ", "_"))

    if rank1 and rank2:
        max_gap = max(EXPERIENCE_RANK.values()) - min(EXPERIENCE_RANK.values())
        seniority = 1 - abs(rank1 - rank2) / max_gap
    else:
        seniority = NEUTRAL

    return 100 * (0.5 * seniority + 0.5 * habits)


_SCORERS = {
    "skills_score": _skills_score,
    "objectives_score": _objectives_score,
    "vision_score": _vision_score,
    "availability_score": _availability_score,
    "work_style_score": _work_style_score,
    "personality_score": _personality_score,
}


# ===== Public API =====

def score_compatibility(
    profile1: Dict[str, Any],
    profile2: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Score two profiles across six dimensions plus a weighted overall.

    Every value is 0-100 and the function is symmetric, deterministic and free.
    `explanation` is a factual summary; the narrative version is generated on
    demand by `ai_service.explain_compatibility`.
    """
    scores = {name: round(scorer(profile1, profile2), 1) for name, scorer in _SCORERS.items()}
    overall = sum(scores[name] * weight for name, weight in DIMENSION_WEIGHTS.items())

    return {
        **scores,
        "overall_score": round(overall, 1),
        "explanation": summarize(profile1, profile2, scores),
        "source": "algorithmic",
    }


def summarize(
    profile1: Dict[str, Any],
    profile2: Dict[str, Any],
    scores: Dict[str, float],
) -> str:
    """
    One-line factual summary of why the score landed where it did.

    Deliberately plain — it states what the data says. The persuasive version is
    the LLM's job.
    """
    parts: List[str] = []

    domains1 = domains_for(profile1.get("skills"), profile1.get("profession") or "")
    domains2 = domains_for(profile2.get("skills"), profile2.get("profession") or "")
    distinct = sorted((domains1 | domains2) - (domains1 & domains2))
    if distinct and scores["skills_score"] >= 60:
        parts.append(f"complementary strengths across {', '.join(distinct[:3])}")
    elif domains1 & domains2:
        parts.append(f"overlapping focus on {', '.join(sorted(domains1 & domains2)[:2])}")

    shared_objectives = _normalized_set(profile1.get("objectives")) & _normalized_set(profile2.get("objectives"))
    if shared_objectives:
        parts.append(f"both aiming at {', '.join(sorted(shared_objectives)[:3])}")

    if scores["availability_score"] >= 90:
        parts.append("matching availability")
    elif scores["availability_score"] <= 40:
        parts.append("a notable gap in weekly availability")

    if not parts:
        return "Not enough profile data yet to say much — completing both profiles will sharpen this."

    return f"Based on profile data: {'; '.join(parts)}."


def dimension_breakdown(scores: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Scores as an ordered, labelled list for the UI, strongest first.

    Keeps the display order and weights in one place instead of hardcoding them in
    the client.
    """
    labels = {
        "skills_score": "Complementary skills",
        "objectives_score": "Shared objectives",
        "vision_score": "Vision & values",
        "availability_score": "Availability",
        "work_style_score": "Work style",
        "personality_score": "Working chemistry",
    }
    return sorted(
        (
            {
                "key": key,
                "label": labels[key],
                "score": scores.get(key, 0),
                "weight": weight,
            }
            for key, weight in DIMENSION_WEIGHTS.items()
        ),
        key=lambda d: d["score"],
        reverse=True,
    )
