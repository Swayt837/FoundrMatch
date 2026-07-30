"""
AI services, on the official Anthropic SDK.

This used to go through `emergentintegrations`, a private SDK that proxied to Claude
and was only installable inside the Emergent platform. It was imported at module
scope, so the backend refused to start anywhere else — and the CI could not run a
single API test. It is gone; this module talks to the Claude API directly.

Two things changed shape in the move:

- **Structured outputs replace hand-rolled JSON parsing.** The old `_ask_json` asked
  for JSON in the prompt, fished it out of whatever prose came back, validated it,
  and retried once when that failed. The API can constrain the response to a schema
  directly, so the extraction, the retry, and the "Return ONLY a JSON object" prompt
  scaffolding are all deleted. The schema is now the single description of the shape.
- **Thinking is on, and spend is controlled with `effort` rather than by turning it
  off.** Disabling thinking on Opus 5 has two documented failure modes — leaked
  `<thinking>` tags in the visible response, and tool calls emitted as plain text —
  and `low`/`medium` effort already captures most of the saving.

`thinking` is passed explicitly on every call rather than relying on the default,
because `LLM_MODEL` is environment-overridable: Opus 5 thinks by default, while
Opus 4.8 and Sonnet 4.6 do not. Being explicit keeps behaviour the same whichever
model is configured.

Without `ANTHROPIC_API_KEY` every method returns None or an empty result and callers
fall back to their deterministic path — compatibility scoring is local arithmetic
(see `compatibility.py`), so the product works without a key; only the narrative,
the premium report, the ideas and the copilot go dark.
"""
import json
import os
from typing import Any, Dict, List, Literal, Optional, Type, TypeVar

import anthropic
from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Overridable so the model can change without a deploy. Opus 5 is the default: the
# remaining LLM work is writing and analysis on a handful of on-demand, cached calls,
# where capability matters more than the per-token difference.
LLM_MODEL = os.getenv("LLM_MODEL", "claude-opus-5")

TModel = TypeVar("TModel", bound=BaseModel)

# Effort tunes how much the model spends per call. These are per-call because the
# work is not uniform: a two-sentence narrative and a due-diligence report should not
# cost the same.
EFFORT_QUICK = "low"
EFFORT_STANDARD = "medium"
EFFORT_DEEP = "high"


def _report_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    """
    The subset of a profile the report prompt should see.

    Explicit allowlist rather than dumping the whole document: photos are useless
    to the model and expensive in tokens, and nothing identifying needs to leave
    the backend for this analysis.
    """
    return {
        field: profile.get(field)
        for field in (
            "profession", "skills", "experience", "availability",
            "objectives", "work_style", "values", "budget", "bio",
        )
    }


# ===== Schemas the model must conform to =====
#
# These are enforced by the API, not requested in the prose. `description` is what
# the model reads, so it carries the guidance the prompt's JSON skeleton used to.

class ExplanationPayload(BaseModel):
    """Narrative for an already-computed score."""
    explanation: str = Field(
        min_length=1,
        max_length=2000,
        description="Two to three sentences addressed to Founder A about Founder B.",
    )


class ReportStrength(BaseModel):
    title: str = Field(description="A few words naming the strength.")
    detail: str = Field(description="One or two sentences grounded in the profile data.")


class ReportRisk(BaseModel):
    title: str = Field(description="A few words naming the risk.")
    severity: Literal["low", "medium", "high"] = "medium"
    detail: str = Field(description="One or two sentences on why this is a risk for this pair.")
    mitigation: str = Field(default="", description="One concrete step that would reduce it.")


class DeepReportPayload(BaseModel):
    """Premium due-diligence read on a pairing."""
    summary: str = Field(description="Two to three sentence overall read.")
    strengths: List[ReportStrength] = Field(default_factory=list)
    risks: List[ReportRisk] = Field(default_factory=list)
    questions_to_ask: List[str] = Field(
        default_factory=list,
        description="Questions Founder A should ask Founder B before committing.",
    )
    unknowns: List[str] = Field(
        default_factory=list,
        description="What these profiles do not tell you, and so cannot be assessed.",
    )


class BusinessIdea(BaseModel):
    title: str = Field(description="The business name.")
    description: str = Field(description="One sentence on what it is.")
    reasoning: str = Field(description="Why it fits this pair's combined skills.")


class BusinessIdeasPayload(BaseModel):
    ideas: List[BusinessIdea] = Field(default_factory=list)


class RoadmapPhase(BaseModel):
    name: str
    duration_days: int = 30
    tasks: List[str] = Field(default_factory=list)
    milestones: List[str] = Field(default_factory=list)


class RoadmapPayload(BaseModel):
    phases: List[RoadmapPhase] = Field(default_factory=list)
    key_metrics: List[str] = Field(default_factory=list)


class AIService:
    """Claude-backed features: narrative, premium report, ideas, roadmap, copilot."""

    def __init__(self):
        # The SDK can also resolve credentials from a local CLI profile, but a server
        # deployment configures the key, so that is what availability keys on — it
        # keeps `available` honest rather than optimistic.
        self.api_key = ANTHROPIC_API_KEY
        self._client = AsyncAnthropic(api_key=self.api_key) if self.api_key else None

    @property
    def available(self) -> bool:
        """False when no API key is configured — callers use their fallback instead."""
        return self._client is not None

    async def _ask_json(
        self,
        label: str,
        system: str,
        prompt: str,
        schema: Type[TModel],
        effort: str = EFFORT_STANDARD,
        max_tokens: int = 4096,
    ) -> Optional[TModel]:
        """
        Ask for a value matching `schema`.

        The API constrains the response to the schema, so there is no parsing step and
        no retry: a malformed shape is not one of the outcomes any more. Returns None
        on failure so the caller can fall back to its deterministic result.
        """
        if not self._client:
            return None

        try:
            response = await self._client.messages.parse(
                model=LLM_MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                output_format=schema,
                output_config={"effort": effort},
                thinking={"type": "adaptive"},
            )
        except anthropic.APIStatusError as e:
            print(f"[ai] {label} failed ({e.status_code}): {e.message}")
            return None
        except anthropic.APIConnectionError as e:
            print(f"[ai] {label} could not reach the API: {e}")
            return None

        # A refusal is a successful HTTP response with no usable content — check it
        # before reading the parsed output, or this reads as an unexplained empty result.
        if response.stop_reason == "refusal":
            print(f"[ai] {label} was declined by the model's safety classifiers")
            return None

        try:
            return response.parsed_output
        except ValidationError as e:
            # The schema is enforced server-side, so this only fires for constraints the
            # SDK validates locally (string lengths, numeric bounds).
            print(f"[ai] {label} failed local validation: {e}")
            return None

    async def _ask_text(
        self,
        label: str,
        system: str,
        prompt: str,
        effort: str = EFFORT_STANDARD,
        max_tokens: int = 4096,
    ) -> Optional[str]:
        """
        Ask for prose. Streamed and then joined: streaming avoids the HTTP timeout on a
        slow generation, and the caller wants one string rather than an event feed.
        """
        if not self._client:
            return None

        try:
            async with self._client.messages.stream(
                model=LLM_MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                output_config={"effort": effort},
                thinking={"type": "adaptive"},
            ) as stream:
                message = await stream.get_final_message()
        except anthropic.APIStatusError as e:
            print(f"[ai] {label} failed ({e.status_code}): {e.message}")
            return None
        except anthropic.APIConnectionError as e:
            print(f"[ai] {label} could not reach the API: {e}")
            return None

        if message.stop_reason == "refusal":
            print(f"[ai] {label} was declined by the model's safety classifiers")
            return None

        # Thinking blocks share the content list with text blocks; only the text is
        # the answer.
        text = "".join(block.text for block in message.content if block.type == "text")
        return text.strip() or None

    # ===== Compatibility narrative =====

    async def explain_compatibility(
        self,
        profile1: Dict[str, Any],
        profile2: Dict[str, Any],
        scores: Dict[str, Any],
    ) -> Optional[str]:
        """
        Write the "why you two" paragraph for an already-computed score.

        The model no longer decides the number — it explains one. That removes the
        non-determinism and the score inflation from ranking, and keeps the LLM
        doing the thing it is actually better at than an algorithm. Returns None if
        the model is unavailable; callers fall back to the factual summary from
        `compatibility.summarize`.
        """
        prompt = f"""Two founders have been matched by a scoring engine. Explain the pairing to them.

Founder A:
- Profession: {profile1.get('profession')}
- Skills: {', '.join(profile1.get('skills') or []) or 'not specified'}
- Experience: {profile1.get('experience')}
- Availability: {profile1.get('availability')}
- Objectives: {', '.join(profile1.get('objectives') or []) or 'not specified'}
- Work style: {', '.join(profile1.get('work_style') or []) or 'not specified'}
- Values: {', '.join(profile1.get('values') or []) or 'not specified'}

Founder B:
- Profession: {profile2.get('profession')}
- Skills: {', '.join(profile2.get('skills') or []) or 'not specified'}
- Experience: {profile2.get('experience')}
- Availability: {profile2.get('availability')}
- Objectives: {', '.join(profile2.get('objectives') or []) or 'not specified'}
- Work style: {', '.join(profile2.get('work_style') or []) or 'not specified'}
- Values: {', '.join(profile2.get('values') or []) or 'not specified'}

Computed scores (0-100), which you must treat as given:
- Complementary skills: {scores.get('skills_score')}
- Shared objectives: {scores.get('objectives_score')}
- Vision & values: {scores.get('vision_score')}
- Availability: {scores.get('availability_score')}
- Work style: {scores.get('work_style_score')}
- Working chemistry: {scores.get('personality_score')}
- Overall: {scores.get('overall_score')}

Write 2-3 sentences addressed to Founder A about Founder B. Ground every claim in the
data above. Name the strongest dimension and, if any score is below 50, name that
tension honestly rather than glossing over it. Do not invent facts, do not restate
the numbers, and do not use bullet points."""

        result = await self._ask_json(
            label="compatibility-explanation",
            system=(
                "You are a business matchmaking expert. You explain scores you are given; "
                "you never re-score."
            ),
            prompt=prompt,
            schema=ExplanationPayload,
            effort=EFFORT_QUICK,
            max_tokens=2048,
        )

        return result.explanation if result else None

    async def deep_compatibility_report(
        self,
        profile1: Dict[str, Any],
        profile2: Dict[str, Any],
        scores: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """
        Premium: full breakdown with founder-risk detection.

        This is the "Deep AI compatibility report" the paywall advertises. It is the
        most demanding analysis in the app, so it runs at high effort — one call per
        request, premium only, cached by pair.
        """
        prompt = f"""Two founders are considering building a company together. Produce a candid
due-diligence read on the pairing for Founder A.

Founder A: {json.dumps(_report_profile(profile1), ensure_ascii=False)}
Founder B: {json.dumps(_report_profile(profile2), ensure_ascii=False)}

Computed compatibility scores (0-100), treat as given: {json.dumps(scores, ensure_ascii=False)}

Be useful rather than encouraging. Founders lose years to partnerships that looked good
on paper, so name the real risks — misaligned commitment, duplicated skills with a gap
nobody covers, incompatible funding philosophy, seniority imbalance, unclear division of
ownership. Ground every point in the data; if something cannot be assessed from these
profiles, say so in `unknowns` instead of speculating."""

        result = await self._ask_json(
            label="compatibility-report",
            system=(
                "You are a diligence analyst for founder partnerships. You are candid about "
                "risk and never inflate a match."
            ),
            prompt=prompt,
            schema=DeepReportPayload,
            effort=EFFORT_DEEP,
            max_tokens=8192,
        )

        return result.model_dump() if result else None

    # ===== Business ideas =====

    async def generate_business_ideas(
        self,
        user1_profile: Dict[str, Any],
        user2_profile: Dict[str, Any],
        count: int = 5,
    ) -> List[Dict[str, str]]:
        """Generate business ideas for a matched pair."""
        shared_objectives = set(
            (user1_profile.get('objectives') or []) + (user2_profile.get('objectives') or [])
        )

        prompt = f"""Based on these two entrepreneurs' profiles, suggest {count} specific
business ideas they could build together.

Person 1: {user1_profile.get('profession')} with skills in {', '.join(user1_profile.get('skills', []))}
Person 2: {user2_profile.get('profession')} with skills in {', '.join(user2_profile.get('skills', []))}

Shared objectives: {', '.join(shared_objectives)}
Combined budget: {user1_profile.get('budget')} + {user2_profile.get('budget')}

Each idea should use both founders' skills, not just one's."""

        result = await self._ask_json(
            label="business-ideas",
            system="You are a startup advisor.",
            prompt=prompt,
            schema=BusinessIdeasPayload,
        )

        if result is not None and result.ideas:
            return [idea.model_dump() for idea in result.ideas]

        return []

    # ===== Roadmap =====

    async def generate_roadmap(
        self,
        project_name: str,
        vision: str,
        participants_skills: List[str],
        duration_days: int = 90,
    ) -> Dict[str, Any]:
        """Generate a roadmap for a project."""
        prompt = f"""Create a {duration_days}-day roadmap for this startup project.

Project: {project_name}
Vision: {vision}
Team skills: {', '.join(participants_skills)}

The phase durations should add up to roughly {duration_days} days, and the tasks should
be things this team can actually do with the skills listed."""

        result = await self._ask_json(
            label="roadmap-gen",
            system="You are a product strategist.",
            prompt=prompt,
            schema=RoadmapPayload,
        )

        if result is not None and result.phases:
            return {**result.model_dump(), "source": "ai"}

        return {"phases": [], "key_metrics": [], "source": "unavailable"}

    # ===== Copilot =====

    async def business_copilot(
        self,
        message: str,
        context: Dict[str, Any],
    ) -> Optional[str]:
        """
        Answer a founder's question about their own startup.

        Free-text rather than schema-constrained — the answer is prose for a human, and
        the route returns it as a single string.
        """
        system = f"""You are CoFound AI Copilot, an expert startup advisor helping entrepreneurs build their business.

User context:
- Profession: {context.get('profession')}
- Skills: {', '.join(context.get('skills') or []) or 'not specified'}
- Experience: {context.get('experience')}
- Objectives: {', '.join(context.get('objectives') or []) or 'not specified'}

Provide concise, actionable advice. Use markdown when helpful. Ask clarifying questions
when needed. Keep responses focused and under 200 words unless the user asks for depth."""

        return await self._ask_text(
            label="copilot",
            system=system,
            prompt=message,
            max_tokens=2048,
        )


# Global AI service instance
ai_service = AIService()
