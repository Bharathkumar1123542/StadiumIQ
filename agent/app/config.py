"""Shared configuration and constants for the StadiumIQ agent.

All tuneable values are read from environment variables so that the same
container image can run in development, staging, and production without
code changes.  Every variable listed here mirrors the canonical reference
in ``context.md §6`` (Environment Variable Quick Reference).
"""
from __future__ import annotations

import os
from typing import TypedDict


class VenueInfo(TypedDict):
    """Metadata record for a single FIFA 2026 host venue."""

    name: str
    city: str
    capacity: int


# ── Service URLs ──────────────────────────────────────────────────
NEXT_BASE_URL: str = os.getenv("NEXT_BASE_URL", "http://localhost:3000")

# ── CORS — comma-separated list of allowed origins (env override for prod) ──
_cors_raw: str = os.getenv("CORS_ORIGINS", "http://localhost:3000")
CORS_ORIGINS: list[str] = [o.strip() for o in _cors_raw.split(",") if o.strip()]

# ── LLM settings (context.md §6 — Concierge Service) ────────────
#   OPENAI_MODEL_PRIMARY    default: gpt-4o
#   GEMINI_MODEL_FALLBACK   default: gemini-2.0-flash
#   LLM_MAX_TOKENS          default: 300  (do NOT raise without Product + Finance sign-off)
#   LLM_FALLBACK_TIMEOUT_MS default: 500  (triggers Gemini fallback on slow OpenAI calls)
#   MAX_CONTEXT_TURNS       default: 8    (Redis conversation history depth)
OPENAI_MODEL_PRIMARY: str = os.getenv("OPENAI_MODEL_PRIMARY", "gpt-4o")
GEMINI_MODEL_FALLBACK: str = os.getenv("GEMINI_MODEL_FALLBACK", "gemini-2.0-flash")
LLM_MAX_TOKENS: int = int(os.getenv("LLM_MAX_TOKENS", "300"))
LLM_FALLBACK_TIMEOUT_MS: int = int(os.getenv("LLM_FALLBACK_TIMEOUT_MS", "500"))
MAX_CONTEXT_TURNS: int = int(os.getenv("MAX_CONTEXT_TURNS", "8"))

# ── Host venues ───────────────────────────────────────────────────
VENUES: dict[str, VenueInfo] = {
    "metlife": {"name": "MetLife Stadium",  "city": "East Rutherford", "capacity": 82500},
    "sofi":    {"name": "SoFi Stadium",     "city": "Los Angeles",     "capacity": 70240},
    "atandt":  {"name": "AT&T Stadium",     "city": "Arlington",       "capacity": 80000},
    "azteca":  {"name": "Estadio Azteca",   "city": "Mexico City",     "capacity": 87500},
    "bcplace": {"name": "BC Place",         "city": "Vancouver",       "capacity": 54500},
}

