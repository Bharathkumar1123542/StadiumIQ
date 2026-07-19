"""
Core agent orchestrator — GPT-4o function-calling loop with:
  - RAG context injection
  - Gemini Flash circuit breaker fallback
  - Language-aware system prompt
  - Moderation pre-pass
  - Agentic tool-call loop (max 3 iterations)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

import openai
from .models import AgentTurnResult, ConciergeChatRequest, RagSource, ToolCallResult, ModerationCategory
from .tools import TOOL_SCHEMAS, dispatch_tool

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────
OPENAI_MODEL   = os.getenv("OPENAI_MODEL",   "gpt-4o")
GEMINI_MODEL   = os.getenv("GEMINI_MODEL",   "gemini-2.0-flash")
MAX_TOOL_ITERS = 3   # prevent infinite loops
TEMPERATURE    = 0.3 # low for factual accuracy

# ── Module-level OpenAI client (reuses connection pool across requests) ──
_openai_client = openai.AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

# ── System prompt ─────────────────────────────────────────────────
SYSTEM_PROMPT_TEMPLATE = """
You are StadiumIQ, the official AI concierge for {venue_name} during FIFA World Cup 2026.
You help fans with navigation, accessibility, facilities, schedules, and safety.

RULES:
1. Always respond in the SAME LANGUAGE the fan used. Detected language: {language_code}.
2. ALWAYS call crowd_density before recommending any walking route.
   If density > 3.5 p/m² on the direct path, recommend an alternative.
3. If the fan mentions any medical emergency, injury, security threat, or lost child,
   call emergency_escalate FIRST before providing any other response.
4. Ground every answer in the retrieved CONTEXT below. Do not invent gate numbers,
   section numbers, or distances.
5. If the context does not contain the answer, say so clearly in the fan's language.
6. Accessibility mode: {accessibility}. If true, only suggest wheelchair-accessible routes.
7. Keep responses under 120 words. Be direct and actionable.
8. Never discuss competing products, brands, or political topics.
9. No fan personal data is stored — reassure fans of this if they ask.

RETRIEVED CONTEXT:
{rag_context}
""".strip()

# ── Input sanitization (Security — context.md §11 checklist) ─────
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

def sanitize_input(text: str) -> str:
    """Strip HTML tags and control characters from user input before LLM injection.

    HTML tags (angle-bracket sequences) are removed, but their text content is
    preserved.  Control characters (except \\t and \\n) are also stripped.

    >>> sanitize_input("<b>hello</b> world")
    'hello world'
    >>> sanitize_input("hello\\x00world")
    'helloworld'
    >>> sanitize_input("  normal text  ")
    'normal text'
    """
    text = _HTML_TAG_RE.sub("", text)
    text = _CONTROL_CHAR_RE.sub("", text)
    return text.strip()

# ── Moderation ────────────────────────────────────────────────────
_PII_PATTERN      = re.compile(r"\b\d{3}-\d{2}-\d{4}\b|\b\d{16}\b")
_OFF_TOPIC_TERMS  = {"bitcoin", "crypto", "stock market", "election", "politician"}
_COMPETITOR_BRANDS = {"ticketmaster", "stubhub", "seatgeek", "vivid seats", "gametime"}

def moderate(text: str) -> ModerationCategory:
    """Pre-LLM moderation: PII, off-topic, and competitor brand detection.

    >>> moderate("my SSN is 123-45-6789")
    'pii_leakage'
    >>> moderate("what about bitcoin prices?")
    'off_topic'
    >>> moderate("ticketmaster sold me fake tickets")
    'competitor_brand'
    >>> moderate("where is the nearest restroom?")
    'safe'
    """
    if _PII_PATTERN.search(text):
        return "pii_leakage"
    lower = text.lower()
    if any(t in lower for t in _OFF_TOPIC_TERMS):
        return "off_topic"
    if any(b in lower for b in _COMPETITOR_BRANDS):
        return "competitor_brand"
    return "safe"

# ── Language detection (lightweight) ─────────────────────────────
def detect_language(text: str, declared: str) -> str:
    """Detect the dominant language of *text*, respecting any explicit *declared* code.

    Returns a BCP-47 language code string. Falls back to ``'en'`` when no
    pattern matches.

    >>> detect_language("hello world", "en")
    'en'
    >>> detect_language("مرحبا", "auto")
    'ar'
    >>> detect_language("こんにちは", "auto")
    'ja'
    """
    if declared != "auto":
        return declared
    patterns: list[tuple[str, str]] = [
        (r"[\u0600-\u06FF]",   "ar"),
        (r"[\u3040-\u309F\u30A0-\u30FF]", "ja"),
        (r"[\u4E00-\u9FFF]",   "zh"),
        (r"[\uAC00-\uD7AF]",   "ko"),
        (r"[\u0900-\u097F]",   "hi"),
        (r"\b(le |la |les |est |que |une )\b", "fr"),
        (r"\b(el |la |está |que |una |con )\b", "es"),
        (r"\b(ist |das |die |der |ein |mit )\b", "de"),
        (r"\b( o | a | os | as |está |uma )\b",  "pt"),
    ]
    for pat, lang in patterns:
        if re.search(pat, text, re.IGNORECASE):
            return lang
    return "en"

# ── Gemini fallback ───────────────────────────────────────────────
async def gemini_fallback(
    system: str, user_message: str, rag_context: str
) -> str:
    """Call Gemini Flash when GPT-4o circuit breaker is open."""
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if not gemini_key:
        logger.warning("[Gemini] GEMINI_API_KEY not configured — returning static fallback")
        return "StadiumIQ is temporarily limited. Please visit a nearby Info Kiosk."
    try:
        import google.generativeai as genai  # type: ignore
        genai.configure(api_key=gemini_key)
        model = genai.GenerativeModel(GEMINI_MODEL)
        response = model.generate_content(
            f"{system}\n\nFan question: {user_message}"
        )
        return response.text or "I'm unable to help with that right now."
    except Exception as e:
        logger.error("[Gemini] Fallback failed: %s", e)
        return "StadiumIQ is temporarily limited. Please visit a nearby Info Kiosk."

# ── Circuit breaker state (in-memory, per process) ───────────────
# Spec (context.md §2): 5 consecutive failures opens; resets after 60s
_CB_FAILURE_COUNT = 0
_CB_OPEN          = False
_CB_LAST_FAILURE  = 0.0
_CB_RESET_AFTER_S = 60  # reset after 60 seconds per spec
_CB_LOCK          = asyncio.Lock()  # guards all CB state mutations

def get_circuit_breaker_state() -> dict[str, Any]:
    """Return current circuit breaker state for health reporting.

    Returns a dict with keys: ``open`` (bool), ``failure_count`` (int),
    ``seconds_until_reset`` (float | None).
    """
    elapsed = time.monotonic() - _CB_LAST_FAILURE if _CB_LAST_FAILURE else None
    seconds_until_reset: float | None = None
    if _CB_OPEN and elapsed is not None:
        remaining = _CB_RESET_AFTER_S - elapsed
        seconds_until_reset = max(0.0, remaining)
    return {
        "open": _CB_OPEN,
        "failure_count": _CB_FAILURE_COUNT,
        "seconds_until_reset": seconds_until_reset,
    }

async def _cb_should_open() -> bool:
    """Return True if the breaker is currently open (and reset it if timeout elapsed)."""
    async with _CB_LOCK:
        global _CB_FAILURE_COUNT, _CB_OPEN, _CB_LAST_FAILURE
        if _CB_OPEN:
            if time.monotonic() - _CB_LAST_FAILURE > _CB_RESET_AFTER_S:
                _CB_OPEN = False
                _CB_FAILURE_COUNT = 0
                logger.info("[CB] Circuit breaker RESET — timeout elapsed")
        return _CB_OPEN

async def _cb_record_failure() -> None:
    async with _CB_LOCK:
        global _CB_FAILURE_COUNT, _CB_OPEN, _CB_LAST_FAILURE
        _CB_FAILURE_COUNT += 1
        _CB_LAST_FAILURE = time.monotonic()
        if _CB_FAILURE_COUNT >= 5:  # 5 consecutive failures per spec
            _CB_OPEN = True
            logger.warning("[CB] Circuit breaker OPEN — switching to Gemini Flash fallback")

async def _cb_record_success() -> None:
    """Decrement failure count on success; breaker stays open until timeout resets it."""
    async with _CB_LOCK:
        global _CB_FAILURE_COUNT
        if _CB_FAILURE_COUNT > 0:
            _CB_FAILURE_COUNT -= 1

# ── Main orchestrator ─────────────────────────────────────────────
async def run_agent(
    request: ConciergeChatRequest,
    rag_sources: list[dict[str, Any]],
    venue_name: str,
    next_base_url: str = "http://localhost:3000",
) -> AgentTurnResult:
    """Execute one agent turn: moderate → detect language → RAG → GPT-4o loop → response.

    Falls back to Gemini Flash if the OpenAI circuit breaker is open or if
    OpenAI returns a retriable error (rate-limit, timeout, connection error).

    Args:
        request:       Validated fan chat request (already sanitized at router level).
        rag_sources:   Top-k documents from the vector store, as plain dicts.
        venue_name:    Human-readable venue name for the system prompt.
        next_base_url: Base URL of the Next.js service (for tool HTTP calls).

    Returns:
        :class:`AgentTurnResult` containing the agent's text reply and metadata.
    """
    start = time.monotonic()
    tool_calls_made: list[ToolCallResult] = []

    # Moderation
    mod_cat = moderate(request.message)
    if mod_cat != "safe":
        logger.info("[Orchestrator] Moderation blocked request: category=%s", mod_cat)
        return AgentTurnResult(
            response_text="For your security and safety, I can't help with that. Please visit an Info Kiosk.",
            language_detected=request.language_code if request.language_code != "auto" else "en",
            llm_provider="fallback",
            rag_sources=[],
            tool_calls_made=[],
            moderation_category=mod_cat,
            total_latency_ms=int((time.monotonic() - start) * 1000),
        )

    # Language detection
    lang = detect_language(request.message, request.language_code)

    # Build RAG context string
    rag_context = "\n\n".join(
        f"[{src['title']}]\n{src['excerpt']}" for src in rag_sources
    ) or "No specific venue context retrieved."

    no_rag = not rag_sources

    # Build system prompt
    system = SYSTEM_PROMPT_TEMPLATE.format(
        venue_name=venue_name,
        language_code=lang,
        accessibility="ON — wheelchair accessible routes only" if request.accessibility else "OFF",
        rag_context=rag_context,
    )

    # Sanitize user input before LLM injection (Security — prevent prompt injection)
    safe_message = sanitize_input(request.message)

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user",   "content": safe_message},
    ]

    llm_provider = "openai"

    # ── Circuit breaker check ────────────────────────────────────
    if await _cb_should_open():
        logger.info("[Orchestrator] Circuit breaker open — using Gemini fallback")
        text = await gemini_fallback(system, safe_message, rag_context)
        return AgentTurnResult(
            response_text=text,
            language_detected=lang,  # type: ignore[arg-type]
            llm_provider="gemini",
            rag_sources=[RagSource(**s) for s in rag_sources],
            tool_calls_made=tool_calls_made,
            total_latency_ms=int((time.monotonic() - start) * 1000),
            no_rag_context=no_rag,
        )

    # ── GPT-4o function-calling loop ─────────────────────────────
    client = _openai_client
    response_text = ""

    try:
        for _iter in range(MAX_TOOL_ITERS + 1):
            resp = await client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=messages,
                tools=TOOL_SCHEMAS,
                tool_choice="auto",
                temperature=TEMPERATURE,
                max_tokens=300,
            )
            await _cb_record_success()

            choice = resp.choices[0]

            # No more tool calls — we have the final answer
            if choice.finish_reason != "tool_calls":
                response_text = choice.message.content or ""
                break

            # Process tool calls
            tool_call_msgs: list[dict[str, Any]] = []
            for tc in (choice.message.tool_calls or []):
                tool_name = tc.function.name
                args_raw  = tc.function.arguments
                try:
                    args = json.loads(args_raw)
                except Exception:
                    logger.warning(
                        "[Orchestrator] Failed to parse tool args for %s: %r",
                        tool_name, args_raw,
                    )
                    args = {}

                result, latency = await dispatch_tool(
                    tool_name, args, next_base_url
                )
                tool_calls_made.append(ToolCallResult(
                    tool_name=tool_name,  # type: ignore[arg-type]
                    args=args,
                    result=result,
                    latency_ms=latency,
                ))
                tool_call_msgs.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result),
                })

            # Append assistant + tool results to conversation
            messages.append({"role": "assistant", "content": None, "tool_calls": choice.message.tool_calls})
            messages.extend(tool_call_msgs)

        else:
            # Exceeded max iterations — ask LLM for a final answer without tools
            logger.warning("[Orchestrator] Max tool iterations (%d) reached", MAX_TOOL_ITERS)
            messages.append({"role": "user", "content": "Please provide your final answer now."})
            final = await client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=messages,
                temperature=TEMPERATURE,
                max_tokens=300,
            )
            response_text = final.choices[0].message.content or ""

    except openai.RateLimitError:
        await _cb_record_failure()
        logger.warning("[Orchestrator] OpenAI rate limit hit — failing over to Gemini")
        response_text = await gemini_fallback(system, safe_message, rag_context)
        llm_provider = "gemini"
    except (openai.APITimeoutError, openai.APIConnectionError) as e:
        await _cb_record_failure()
        logger.error("[Orchestrator] OpenAI connection error: %s", e)
        response_text = await gemini_fallback(system, safe_message, rag_context)
        llm_provider = "gemini"
    except Exception as e:
        logger.exception("[Orchestrator] Unexpected error during agent loop: %s", e)
        response_text = "I'm temporarily unable to process your request. Please try again or visit an Info Kiosk."
        llm_provider = "fallback"

    return AgentTurnResult(
        response_text=response_text,
        language_detected=lang,  # type: ignore[arg-type]
        llm_provider=llm_provider,  # type: ignore[arg-type]
        rag_sources=[RagSource(**s) for s in rag_sources],
        tool_calls_made=tool_calls_made,
        total_latency_ms=int((time.monotonic() - start) * 1000),
        no_rag_context=no_rag,
    )
