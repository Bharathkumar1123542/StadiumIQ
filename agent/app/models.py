"""
Pydantic models shared across the agent — mirrors TypeScript types/index.ts

All models use camelCase aliases so responses are directly consumable by the
TypeScript frontend without any mapping layer.
"""
from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator


LanguageCode = Literal[
    "en", "es", "fr", "pt", "ar",
    "de", "ja", "ko", "zh", "hi", "auto"
]

LLMProvider = Literal["openai", "gemini", "fallback"]

ModerationCategory = Literal["safe", "pii_leakage", "off_topic", "competitor_brand"]

ToolName = Literal[
    "venue_search", "schedule_lookup",
    "accessibility_route", "emergency_escalate", "crowd_density",
]


class ConciergeChatRequest(BaseModel):
    """Incoming request from the fan concierge frontend."""

    session_id: str  = Field(alias="sessionId")
    venue_id:   str  = Field(alias="venueId")
    message:    str
    language_code: LanguageCode = Field(default="auto", alias="languageCode")
    accessibility: bool = False
    zone_id:    str | None = Field(default=None, alias="zoneId")

    model_config = {"populate_by_name": True}

    @field_validator("session_id")
    @classmethod
    def session_id_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("sessionId must not be empty")
        return v

    @field_validator("venue_id")
    @classmethod
    def venue_id_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("venueId must not be empty")
        return v

    @field_validator("message")
    @classmethod
    def message_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("message must not be empty")
        return v


class RagSource(BaseModel):
    """A single RAG retrieval result returned to the frontend."""

    document_id: str
    title:       str
    excerpt:     str
    score:       float = Field(ge=0.0, le=1.0, description="Cosine similarity score, 0–1")


class ToolCallResult(BaseModel):
    """Record of a single GPT-4o tool call made during an agent turn."""

    tool_name:  ToolName
    args:       dict[str, Any]
    result:     dict[str, Any] | None
    latency_ms: int = Field(ge=0, description="Round-trip latency in milliseconds")


class AgentTurnResult(BaseModel):
    """Full response envelope returned by the agent to the Next.js concierge route."""

    response_text:      str
    audio_url:          str | None = None
    language_detected:  LanguageCode
    llm_provider:       LLMProvider
    rag_sources:        list[RagSource]
    tool_calls_made:    list[ToolCallResult]
    truncated:          bool = False
    moderation_category: ModerationCategory = "safe"
    total_latency_ms:   int = Field(ge=0)
    no_rag_context:     bool = False
