"""
AI Services using Claude for compatibility scoring and business assistance.

Every LLM call goes through `_ask_json`, which extracts JSON out of whatever the
model returned, validates it against a Pydantic schema and retries once before
giving up. When the model is unavailable the caller gets a deterministic
heuristic score tagged `source="heuristic"` instead of a hardcoded 74% dressed up
as an AI verdict — the UI shows that distinction to the user.
"""
import os
import json
from typing import Any, Dict, List, Literal, Optional, Type, TypeVar

from pydantic import BaseModel, Field, ValidationError
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
from compatibility import extract_json
from dotenv import load_dotenv

load_dotenv()

EMERGENT_LLM_KEY = os.getenv("EMERGENT_LLM_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-4-6")

TModel = TypeVar("TModel", bound=BaseModel)


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

class ExplanationPayload(BaseModel):
    """Narrative for an already-computed score."""
    explanation: str = Field(min_length=1, max_length=2000)


class ReportStrength(BaseModel):
    title: str
    detail: str


class ReportRisk(BaseModel):
    title: str
    severity: Literal["low", "medium", "high"] = "medium"
    detail: str
    mitigation: str = ""


class DeepReportPayload(BaseModel):
    """Premium due-diligence read on a pairing."""
    summary: str
    strengths: List[ReportStrength] = Field(default_factory=list)
    risks: List[ReportRisk] = Field(default_factory=list)
    questions_to_ask: List[str] = Field(default_factory=list)
    unknowns: List[str] = Field(default_factory=list)


class BusinessIdea(BaseModel):
    title: str
    description: str
    reasoning: str


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
    """AI Service for compatibility and business assistance"""

    def __init__(self):
        self.api_key = EMERGENT_LLM_KEY

    @property
    def available(self) -> bool:
        """False when no LLM key is configured — callers use heuristics instead."""
        return bool(self.api_key)

    async def _stream_text(self, session_id: str, system_message: str, prompt: str) -> str:
        chat = LlmChat(
            api_key=self.api_key,
            session_id=session_id,
            system_message=system_message,
        ).with_model("anthropic", LLM_MODEL)

        response_text = ""
        async for event in chat.stream_message(UserMessage(text=prompt)):
            if isinstance(event, TextDelta):
                response_text += event.content
            elif isinstance(event, StreamDone):
                break
        return response_text

    async def _ask_json(
        self,
        session_id: str,
        system_message: str,
        prompt: str,
        schema: Type[TModel],
        wrap_list_as: Optional[str] = None,
        attempts: int = 2,
    ) -> Optional[TModel]:
        """
        Ask the model for JSON and validate it. Returns None if every attempt
        fails, letting the caller fall back to a deterministic result.

        `wrap_list_as` lets a schema with a single list field accept a bare JSON
        array, which is what the model returns for "give me a list of ideas".
        """
        if not self.available:
            return None

        last_error: Optional[Exception] = None
        for attempt in range(attempts):
            try:
                raw = await self._stream_text(session_id, system_message, prompt)
                payload = extract_json(raw)
                if wrap_list_as and isinstance(payload, list):
                    payload = {wrap_list_as: payload}
                return schema.model_validate(payload)
            except (ValueError, ValidationError, json.JSONDecodeError) as e:
                # Malformed output: worth one more shot, the model is stochastic.
                last_error = e
            except Exception as e:
                # Transport/auth failure: retrying won't help.
                print(f"[ai] {session_id} call failed: {e}")
                return None

        print(f"[ai] {session_id} returned unusable JSON after {attempts} attempts: {last_error}")
        return None

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
the numbers, and do not use bullet points.

Return ONLY a JSON object: {{"explanation": "<your 2-3 sentences>"}}"""

        result = await self._ask_json(
            session_id="compatibility-explanation",
            system_message=(
                "You are a business matchmaking expert. You explain scores you are given; "
                "you never re-score. Always respond with valid JSON only."
            ),
            prompt=prompt,
            schema=ExplanationPayload,
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

        This is the "Deep AI compatibility report" the paywall advertises. Unlike the
        feed explanation it is expensive and slow by design — one call per request,
        premium only, cached by pair.
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
profiles, say so instead of speculating.

Return ONLY a JSON object with this structure:
{{
  "summary": "<2-3 sentence overall read>",
  "strengths": [{{"title": "<short>", "detail": "<1-2 sentences>"}}],
  "risks": [{{"title": "<short>", "severity": "low|medium|high", "detail": "<1-2 sentences>", "mitigation": "<one concrete step>"}}],
  "questions_to_ask": ["<question A should ask B before committing>"],
  "unknowns": ["<what these profiles do not tell you>"]
}}"""

        result = await self._ask_json(
            session_id="compatibility-report",
            system_message=(
                "You are a diligence analyst for founder partnerships. You are candid about "
                "risk and never inflate a match. Always respond with valid JSON only."
            ),
            prompt=prompt,
            schema=DeepReportPayload,
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

        prompt = f"""
Based on these two entrepreneurs' profiles, suggest {count} specific business ideas they could build together.

Person 1: {user1_profile.get('profession')} with skills in {', '.join(user1_profile.get('skills', []))}
Person 2: {user2_profile.get('profession')} with skills in {', '.join(user2_profile.get('skills', []))}

Shared objectives: {', '.join(shared_objectives)}
Combined budget: {user1_profile.get('budget')} + {user2_profile.get('budget')}

Return ONLY a JSON array with this structure (no markdown):
[
  {{
    "title": "<Business name>",
    "description": "<One sentence description>",
    "reasoning": "<Why this fits their skills>"
  }}
]
"""

        result = await self._ask_json(
            session_id="business-ideas",
            system_message="You are a startup advisor. Always respond with valid JSON only.",
            prompt=prompt,
            schema=BusinessIdeasPayload,
            wrap_list_as="ideas",
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
        prompt = f"""
Create a {duration_days}-day roadmap for this startup project:

Project: {project_name}
Vision: {vision}
Team Skills: {', '.join(participants_skills)}

Return ONLY a JSON object with this structure (no markdown):
{{
  "phases": [
    {{
      "name": "<Phase name>",
      "duration_days": <number>,
      "tasks": ["<task 1>", "<task 2>"],
      "milestones": ["<milestone 1>"]
    }}
  ],
  "key_metrics": ["<metric 1>", "<metric 2>"]
}}
"""

        result = await self._ask_json(
            session_id="roadmap-gen",
            system_message="You are a product strategist. Always respond with valid JSON only.",
            prompt=prompt,
            schema=RoadmapPayload,
        )

        if result is not None and result.phases:
            return {**result.model_dump(), "source": "ai"}

        return {"phases": [], "key_metrics": [], "source": "unavailable"}

    async def ai_assistant_chat(
        self,
        session_id: str,
        message: str,
        context: Dict[str, Any],
    ):
        """AI assistant for business questions and guidance. Returns a stream."""
        system_message = f"""
You are an AI business cofounder assistant helping entrepreneurs build their startup.

Context:
- Project: {context.get('project_name', 'New Startup')}
- Team Skills: {', '.join(context.get('team_skills', []))}
- Current Stage: {context.get('stage', 'Planning')}

Provide actionable, specific advice.
"""
        chat = LlmChat(
            api_key=self.api_key,
            session_id=f"assistant-{session_id}",
            system_message=system_message,
        ).with_model("anthropic", LLM_MODEL)

        return chat.stream_message(UserMessage(text=message))


# Global AI service instance
ai_service = AIService()
