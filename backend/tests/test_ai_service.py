"""
AI service tests — no API key, no network.

Three things are worth pinning down here, and none of them need a real call:

1. **The app works without an API key.** Compatibility scoring is local arithmetic, so
   a missing key must degrade the narrative and the report, not break matching. Every
   method has to return its documented fallback rather than raise.
2. **The output schemas are valid for structured outputs.** The API constrains
   responses to these schemas, and it rejects constructs like recursive models or
   `pattern` on a string. That rejection would be a 400 at runtime, in production, on
   a feature nobody exercises locally — so it is checked at build time instead.
3. **A refusal is not an answer.** A declined request comes back as a successful HTTP
   response with no usable content; code that reads the payload without checking
   `stop_reason` turns that into a confusing empty result.

Run with: pytest backend/tests -o addopts='' -q
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ai_service as ai_service_module  # noqa: E402
from ai_service import AIService  # noqa: E402

PROFILE_A = {
    "profession": "developer",
    "skills": ["React", "Python"],
    "experience": "senior",
    "availability": "full_time",
    "objectives": ["fast_growth"],
    "work_style": ["remote"],
    "values": ["transparency"],
    "budget": "20k",
    "bio": "Builds things.",
}
PROFILE_B = {**PROFILE_A, "profession": "sales", "skills": ["B2B Sales"]}
SCORES = {"overall_score": 72.0, "skills_score": 88.0}


def run(coroutine):
    return asyncio.run(coroutine)


@pytest.fixture
def offline(monkeypatch):
    """An AIService with no API key configured."""
    monkeypatch.setattr(ai_service_module, "ANTHROPIC_API_KEY", None)
    return AIService()


class TestWorksWithoutAKey:
    def test_reports_itself_unavailable(self, offline):
        assert offline.available is False

    def test_narrative_returns_none(self, offline):
        """Callers fall back to `compatibility.summarize`, which is deterministic."""
        assert run(offline.explain_compatibility(PROFILE_A, PROFILE_B, SCORES)) is None

    def test_deep_report_returns_none(self, offline):
        assert run(offline.deep_compatibility_report(PROFILE_A, PROFILE_B, SCORES)) is None

    def test_business_ideas_returns_empty_list(self, offline):
        assert run(offline.generate_business_ideas(PROFILE_A, PROFILE_B)) == []

    def test_roadmap_reports_unavailable_rather_than_empty(self, offline):
        """
        The deal room refuses to overwrite a good roadmap with an empty one, so the
        `source` marker is what it branches on.
        """
        roadmap = run(offline.generate_roadmap("Acme", "A thing", ["Python"]))

        assert roadmap["phases"] == []
        assert roadmap["source"] == "unavailable"

    def test_copilot_returns_none(self, offline):
        assert run(offline.business_copilot("How do I price this?", {})) is None


class TestSchemasAreValidForStructuredOutputs:
    """
    The API validates these schemas and rejects unsupported JSON Schema constructs.
    Catching that here beats catching it as a 400 in production.
    """

    @pytest.mark.parametrize(
        "schema",
        [
            ai_service_module.ExplanationPayload,
            ai_service_module.DeepReportPayload,
            ai_service_module.BusinessIdeasPayload,
            ai_service_module.RoadmapPayload,
        ],
        ids=lambda s: s.__name__,
    )
    def test_schema_transforms(self, schema):
        from anthropic.lib._parse._transform import transform_schema
        from pydantic import TypeAdapter

        transformed = transform_schema(TypeAdapter(schema).json_schema())

        # Structured outputs require a closed object — an open one is silently
        # permissive and lets the model invent fields the app then ignores.
        assert transformed["additionalProperties"] is False

    def test_field_guidance_reaches_the_model(self):
        """
        The prompts used to carry a JSON skeleton describing each field. That moved
        into the schema, so the descriptions have to actually survive the transform.
        """
        from anthropic.lib._parse._transform import transform_schema
        from pydantic import TypeAdapter

        transformed = transform_schema(
            TypeAdapter(ai_service_module.DeepReportPayload).json_schema()
        )

        description = transformed["properties"]["questions_to_ask"]["description"]
        assert "second person" in description


class _FakeMessage:
    def __init__(self, stop_reason="end_turn", parsed=None, content=None):
        self.stop_reason = stop_reason
        self._parsed = parsed
        self.content = content or []

    @property
    def parsed_output(self):
        return self._parsed


class _Block:
    def __init__(self, type_, text=""):
        self.type = type_
        self.text = text


def _client_returning(message):
    """A stand-in client whose `messages.parse` yields `message`."""

    class _Messages:
        async def parse(self, **kwargs):
            return message

    class _Client:
        messages = _Messages()

    return _Client()


def _client_raising(error):
    class _Messages:
        async def parse(self, **kwargs):
            raise error

    class _Client:
        messages = _Messages()

    return _Client()


class TestResponseHandling:
    def _service(self, monkeypatch, client):
        monkeypatch.setattr(ai_service_module, "ANTHROPIC_API_KEY", "sk-test")
        service = AIService()
        service._client = client
        return service

    def test_parsed_output_is_returned(self, monkeypatch):
        payload = ai_service_module.ExplanationPayload(explanation="You two fit.")
        service = self._service(monkeypatch, _client_returning(_FakeMessage(parsed=payload)))

        result = run(service.explain_compatibility(PROFILE_A, PROFILE_B, SCORES))

        assert result == "You two fit."

    def test_refusal_is_not_treated_as_an_answer(self, monkeypatch):
        """
        A refusal is HTTP 200 with empty content. Reading the payload without checking
        `stop_reason` would surface it as a mysterious blank narrative.
        """
        service = self._service(
            monkeypatch, _client_returning(_FakeMessage(stop_reason="refusal", parsed=None))
        )

        assert run(service.explain_compatibility(PROFILE_A, PROFILE_B, SCORES)) is None

    def test_api_error_falls_back_rather_than_propagating(self, monkeypatch):
        """A model outage must not turn into a 500 on a profile page."""
        import anthropic
        import httpx

        error = anthropic.APIStatusError(
            "boom",
            response=httpx.Response(500, request=httpx.Request("POST", "https://api.anthropic.com")),
            body=None,
        )
        service = self._service(monkeypatch, _client_raising(error))

        assert run(service.explain_compatibility(PROFILE_A, PROFILE_B, SCORES)) is None

    def test_connection_error_falls_back(self, monkeypatch):
        import anthropic
        import httpx

        error = anthropic.APIConnectionError(
            request=httpx.Request("POST", "https://api.anthropic.com")
        )
        service = self._service(monkeypatch, _client_raising(error))

        assert run(service.generate_business_ideas(PROFILE_A, PROFILE_B)) == []


class TestTextExtraction:
    def test_thinking_blocks_are_not_part_of_the_answer(self, monkeypatch):
        """
        Thinking blocks share the content list with text blocks. Concatenating
        everything would put the model's reasoning into the user's chat window.
        """
        message = _FakeMessage(
            content=[
                _Block("thinking", "internal reasoning that must not be shown"),
                _Block("text", "Price it per seat."),
            ]
        )

        class _Stream:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def get_final_message(self):
                return message

        class _Messages:
            def stream(self, **kwargs):
                return _Stream()

        class _Client:
            messages = _Messages()

        monkeypatch.setattr(ai_service_module, "ANTHROPIC_API_KEY", "sk-test")
        service = AIService()
        service._client = _Client()

        result = run(service.business_copilot("How do I price this?", {}))

        assert result == "Price it per seat."


def test_narrative_prompt_speaks_to_the_reader():
    """
    The prompt used to label the two people "Founder A" and "Founder B", and the
    model echoed that straight into a paragraph shown next to someone's face.
    """
    import inspect
    import ai_service as m

    source = inspect.getsource(m.AIService.explain_compatibility)
    assert "Founder A" not in source and "Founder B" not in source
    assert "_first_name(profile2)" in source

    report = inspect.getsource(m.AIService.deep_compatibility_report)
    assert "Founder A" not in report and "Founder B" not in report


def test_first_name_takes_only_the_first_token():
    import ai_service as m

    assert m._first_name({"name": "Sarah Chen"}) == "Sarah"
    assert m._first_name({"name": "  Jean-Pierre Dupont "}) == "Jean-Pierre"
    # A placeholder the model would echo verbatim is worse than a neutral phrase.
    assert m._first_name({}) == "this founder"
    assert m._first_name({"name": "   "}) == "this founder"
