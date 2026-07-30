"""
Compatibility scoring logic, with no external dependencies.

Kept separate from `ai_service` so the deterministic parts — JSON extraction and
the heuristic fallback — can be imported and tested without the LLM SDK, a
database or a network connection.
"""
import json
import re
from typing import Any, Dict

# Rough weekly-hours equivalent, used to compare availability commitments.
AVAILABILITY_HOURS = {
    "full_time": 40,
    "immediate": 40,
    "20h_week": 20,
    "10h_week": 10,
    "evenings": 12,
    "weekends": 12,
}

# How much each dimension contributes to the overall score.
DIMENSION_WEIGHTS = {
    "skills_score": 0.30,
    "objectives_score": 0.20,
    "vision_score": 0.15,
    "availability_score": 0.15,
    "work_style_score": 0.10,
    "personality_score": 0.10,
}

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def extract_json(text: str) -> Any:
    """
    Pull a JSON value out of a model response.

    Handles bare JSON, fenced blocks, and prose wrapped around the payload. The
    previous implementation sliced off the first and last line, which silently
    corrupted any response whose fence was missing or unbalanced.
    """
    cleaned = _FENCE_RE.sub("", (text or "").strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Fall back to the outermost object/array in the response.
    for opener, closer in (("{", "}"), ("[", "]")):
        start = cleaned.find(opener)
        end = cleaned.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except json.JSONDecodeError:
                continue

    raise ValueError("No JSON object found in model response")


def _normalized(values: Any) -> set:
    """Lower-case, trimmed set of tag-like values; empty for anything missing."""
    if not values:
        return set()
    return {str(v).strip().lower() for v in values if str(v).strip()}


def _overlap_ratio(a: set, b: set) -> float:
    """Jaccard similarity; 0.0 when either side is empty (unknown, not opposed)."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def heuristic_compatibility(
    profile1: Dict[str, Any],
    profile2: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Score two profiles without the LLM.

    Same six dimensions as the AI path so the UI renders identically, but derived
    from profile overlap: complementary skills and professions score high, shared
    objectives and values score high, and availability is compared on committed
    hours. Tagged `source="heuristic"` so the client can label it honestly instead
    of presenting a fallback as a real AI verdict.
    """
    skills1, skills2 = _normalized(profile1.get("skills")), _normalized(profile2.get("skills"))
    objectives1, objectives2 = _normalized(profile1.get("objectives")), _normalized(profile2.get("objectives"))
    values1, values2 = _normalized(profile1.get("values")), _normalized(profile2.get("values"))
    style1, style2 = _normalized(profile1.get("work_style")), _normalized(profile2.get("work_style"))

    # Skills: complementarity wins. Different professions plus little skill
    # overlap is the ideal cofounder pairing.
    skills_overlap = _overlap_ratio(skills1, skills2)
    different_profession = bool(
        profile1.get("profession")
        and profile2.get("profession")
        and profile1.get("profession") != profile2.get("profession")
    )
    skills_score = (55 if different_profession else 35) + 45 * (1 - skills_overlap)

    # Objectives and values: alignment wins.
    objectives_score = 45 + 55 * _overlap_ratio(objectives1, objectives2)
    vision_score = 45 + 55 * (
        (_overlap_ratio(values1, values2) + _overlap_ratio(objectives1, objectives2)) / 2
    )

    # Availability: compare committed hours.
    hours1 = AVAILABILITY_HOURS.get(str(profile1.get("availability") or "").lower())
    hours2 = AVAILABILITY_HOURS.get(str(profile2.get("availability") or "").lower())
    if hours1 and hours2:
        availability_score = 100 - min(60, abs(hours1 - hours2) * 2)
    else:
        availability_score = 60.0

    # Work style and personality: shared habits reduce friction.
    style_overlap = _overlap_ratio(style1, style2)
    work_style_score = 50 + 50 * style_overlap
    personality_score = 55 + 45 * style_overlap

    scores = {
        "skills_score": round(min(100.0, skills_score), 1),
        "vision_score": round(min(100.0, vision_score), 1),
        "availability_score": round(min(100.0, float(availability_score)), 1),
        "personality_score": round(min(100.0, personality_score), 1),
        "objectives_score": round(min(100.0, objectives_score), 1),
        "work_style_score": round(min(100.0, work_style_score), 1),
    }

    overall = sum(scores[dimension] * weight for dimension, weight in DIMENSION_WEIGHTS.items())

    shared = sorted(objectives1 & objectives2)
    if shared:
        explanation = (
            f"Estimated from profile data: complementary skill sets and shared interest in "
            f"{', '.join(shared[:3])}. Detailed AI analysis is temporarily unavailable."
        )
    else:
        explanation = (
            "Estimated from profile data: skills, availability and working habits look "
            "workable together. Detailed AI analysis is temporarily unavailable."
        )

    return {
        **scores,
        "overall_score": round(overall, 1),
        "explanation": explanation,
        "source": "heuristic",
    }
