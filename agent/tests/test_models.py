"""Unit tests for Pydantic request/response models."""
from __future__ import annotations

import pytest
from pydantic import ValidationError
from app.models import ConciergeChatRequest, RagSource, AgentTurnResult, ToolCallResult


class TestConciergeChatRequest:
    def _valid_payload(self, **overrides):
        base = {
            "sessionId": "sess_abc123",
            "venueId": "metlife",
            "message": "Where is the restroom?",
            "languageCode": "auto",
            "accessibility": False,
            "zoneId": None,
        }
        base.update(overrides)
        return base

    def test_valid_request_parses(self):
        req = ConciergeChatRequest.model_validate(self._valid_payload())
        assert req.venue_id == "metlife"
        assert req.message == "Where is the restroom?"

    def test_camel_case_aliases(self):
        req = ConciergeChatRequest.model_validate(self._valid_payload())
        assert req.session_id == "sess_abc123"
        assert req.zone_id is None

    def test_empty_session_id_rejected(self):
        with pytest.raises(ValidationError):
            ConciergeChatRequest.model_validate(self._valid_payload(sessionId="   "))

    def test_empty_venue_id_rejected(self):
        with pytest.raises(ValidationError):
            ConciergeChatRequest.model_validate(self._valid_payload(venueId=""))

    def test_empty_message_rejected(self):
        with pytest.raises(ValidationError):
            ConciergeChatRequest.model_validate(self._valid_payload(message="\n\t"))

    def test_default_language_is_auto(self):
        payload = self._valid_payload()
        del payload["languageCode"]
        req = ConciergeChatRequest.model_validate(payload)
        assert req.language_code == "auto"

    def test_invalid_language_code_rejected(self):
        with pytest.raises(ValidationError):
            ConciergeChatRequest.model_validate(self._valid_payload(languageCode="zz"))


class TestRagSource:
    def test_valid_source(self):
        src = RagSource(
            document_id="doc_1",
            title="Test Doc",
            excerpt="Some text",
            score=0.85,
        )
        assert src.score == 0.85

    def test_score_too_high_rejected(self):
        with pytest.raises(ValidationError):
            RagSource(document_id="d", title="t", excerpt="e", score=1.5)

    def test_score_negative_rejected(self):
        with pytest.raises(ValidationError):
            RagSource(document_id="d", title="t", excerpt="e", score=-0.1)


class TestToolCallResult:
    def test_negative_latency_rejected(self):
        with pytest.raises(ValidationError):
            ToolCallResult(
                tool_name="crowd_density",
                args={},
                result=None,
                latency_ms=-1,
            )

    def test_zero_latency_accepted(self):
        tcr = ToolCallResult(
            tool_name="crowd_density",
            args={"venue_id": "metlife"},
            result={"avg_density": 2.1},
            latency_ms=0,
        )
        assert tcr.latency_ms == 0
