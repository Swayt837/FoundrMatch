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
from typing import Any, Dict, List, Optional, Type, TypeVar

from pydantic import BaseModel, Field, ValidationError, field_validator
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
from compatibility import extract_json, heuristic_compatibility
from dotenv import load_dotenv

load_dotenv()

EMERGENT_LLM_KEY = os.getenv("EMERGENT_LLM_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-4-6")

TModel = TypeVar("TModel", bound=BaseModel)


# ===== Schemas the model must conform to =====

class CompatibilityPayload(BaseModel):
    """The six dimensions Claude is asked to score, plus its explanation."""
    skills_score: float
    vision_score: float
    availability_score: float
    personality_score: float
    objectives_score: float
    work_style_score: float
    overall_score: float
    explanation: str

    @field_validator(
        "skills_score", "vision_score", "availability_score",
        "personality_score", "objectives_score", "work_style_score",
        "overall_score",
        mode="after",
    )
    @classmethod
    def clamp(cls, value: float) -> float:
        """A model that answers 0-10 or 120 shouldn't corrupt the UI."""
        return max(0.0, min(100.0, float(value)))


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

    # ===== Compatibility =====

    async def calculate_compatibility(
        self,
        user1: Dict[str, Any],
        user2: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Score compatibility between two users across six dimensions.

        The returned dict carries a `source` field: "ai" when Claude produced the
        analysis, "heuristic" when it was computed locally from profile overlap.
        """
        profile1 = user1.get("profile", {}) or {}
        profile2 = user2.get("profile", {}) or {}

        prompt = f"""
You are an expert business matchmaker. Analyze the compatibility between these two entrepreneurs.

Person 1:
- Profession: {profile1.get('profession')}
- Skills: {', '.join(profile1.get('skills', []))}
- Experience: {profile1.get('experience')}
- Availability: {profile1.get('availability')}
- Objectives: {', '.join(profile1.get('objectives', []))}
- Work Style: {', '.join(profile1.get('work_style', []))}
- Values: {', '.join(profile1.get('values', []))}
- Budget: {profile1.get('budget')}

Person 2:
- Profession: {profile2.get('profession')}
- Skills: {', '.join(profile2.get('skills', []))}
- Experience: {profile2.get('experience')}
- Availability: {profile2.get('availability')}
- Objectives: {', '.join(profile2.get('objectives', []))}
- Work Style: {', '.join(profile2.get('work_style', []))}
- Values: {', '.join(profile2.get('values', []))}
- Budget: {profile2.get('budget')}

Provide a compatibility analysis with scores (0-100) for:
1. Skills Compatibility (complementary skills are better than identical ones)
2. Vision Alignment (similar long-term intent and values)
3. Availability Match
4. Personality/Work Style Compatibility
5. Objectives Alignment
6. Work Style Match

Return ONLY a JSON object with this exact structure (no markdown, no extra text):
{{
  "skills_score": <number>,
  "vision_score": <number>,
  "availability_score": <number>,
  "personality_score": <number>,
  "objectives_score": <number>,
  "work_style_score": <number>,
  "overall_score": <number>,
  "explanation": "<2-3 sentence explanation of why they're compatible>"
}}
"""

        result = await self._ask_json(
            session_id="compatibility-analysis",
            system_message="You are a business matchmaking expert. Always respond with valid JSON only.",
            prompt=prompt,
            schema=CompatibilityPayload,
        )

        if result is not None:
            return {**result.model_dump(), "source": "ai"}

        return heuristic_compatibility(profile1, profile2)

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
