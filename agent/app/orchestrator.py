"""
Core agent orchestrator — GPT-4o function-calling loop with:
  - RAG context injection
  - Gemini Flash circuit breaker fallback
  - Language-aware system prompt
  - Moderation pre-pass
  - Agentic tool-call loop (max 3 iterations)
  - Per-call timeout triggering Gemini fallback (LLM_FALLBACK_TIMEOUT_MS)
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import os
import re
import time
from typing import Any

import openai
from .config import (
    OPENAI_MODEL_PRIMARY,
    GEMINI_MODEL_FALLBACK,
    LLM_MAX_TOKENS,
    LLM_FALLBACK_TIMEOUT_MS,
)
from .models import AgentTurnResult, ConciergeChatRequest, RagSource, ToolCallResult, ModerationCategory
from .tools import TOOL_SCHEMAS, dispatch_tool

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────
MAX_TOOL_ITERS = 3   # prevent infinite tool-call loops
TEMPERATURE    = 0.3 # low temperature for factual, grounded responses

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

    Performs lightweight, regex/keyword-based moderation on raw user input
    before it reaches the LLM.  This is the first line of defence; the
    ModerationService (GPT-4o-mini) acts as the second pass on LLM *output*.

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
    """Call Gemini Flash when the GPT-4o circuit breaker is open or a call times out.

    Uses the ``google.generativeai`` SDK (different from the OpenAI SDK —
    not interchangeable via env var; see context.md §3 Constraint #1).

    Args:
        system:       Full system prompt string already rendered with RAG context.
        user_message: Sanitized fan message.
        rag_context:  RAG context string (included for completeness; already in
                      *system* but passed here for potential future SDK variants).

    Returns:
        Model response text, or a static fallback string if Gemini is also unavailable.
    """
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if not gemini_key:
        logger.warning("[Gemini] GEMINI_API_KEY not configured — returning static fallback")
        return "StadiumIQ is temporarily limited. Please visit a nearby Info Kiosk."
    try:
        import google.generativeai as genai  # type: ignore
        genai.configure(api_key=gemini_key)
        model = genai.GenerativeModel(GEMINI_MODEL_FALLBACK)
        response = model.generate_content(
            f"{system}\n\nFan question: {user_message}"
        )
        return response.text or "I'm unable to help with that right now."
    except Exception as e:
        logger.error("[Gemini] Fallback failed: %s", e)
        return "StadiumIQ is temporarily limited. Please visit a nearby Info Kiosk."

# ── Circuit breaker state ─────────────────────────────────────────
# Spec (context.md §2): 5 consecutive failures opens the breaker;
# resets automatically after 60 s (half-open probe on next request).
_CB_RESET_AFTER_S = 60  # reset timeout in seconds per spec


@dataclasses.dataclass
class _CircuitBreaker:
    """In-process circuit breaker for the OpenAI GPT-4o client.

    All state is guarded by a single ``asyncio.Lock`` to prevent concurrent
    coroutines from racing on ``failure_count`` increments.  The breaker is
    intentionally process-local (not distributed) — each pod maintains its
    own state, which is sufficient for the per-pod rate of OpenAI calls.

    Attributes:
        failure_count:   Number of consecutive failures since last success.
        open:            True when the breaker is tripped and Gemini is active.
        last_failure_ts: ``time.monotonic()`` timestamp of the most recent failure.
        lock:            Async lock protecting all mutations.
    """

    failure_count: int = 0
    open: bool = False
    last_failure_ts: float = 0.0
    lock: asyncio.Lock = dataclasses.field(default_factory=asyncio.Lock)


_cb = _CircuitBreaker()


def get_circuit_breaker_state() -> dict[str, Any]:
    """Return the current circuit breaker state for health reporting.

    Returns a dict with keys: ``open`` (bool), ``failure_count`` (int),
    ``seconds_until_reset`` (float | None).

    This function is intentionally non-async and lock-free so it can be
    called cheaply from the ``/health`` endpoint without blocking.  A small
    window of stale reads is acceptable for observability.
    """
    elapsed = time.monotonic() - _cb.last_failure_ts if _cb.last_failure_ts else None
    seconds_until_reset: float | None = None
    if _cb.open and elapsed is not None:
        seconds_until_reset = max(0.0, _CB_RESET_AFTER_S - elapsed)
    return {
        "open": _cb.open,
        "failure_count": _cb.failure_count,
        "seconds_until_reset": seconds_until_reset,
    }


async def _cb_should_open() -> bool:
    """Return True if the circuit breaker is currently open.

    Also handles the half-open probe: if the breaker is open and the reset
    timeout has elapsed, the breaker is automatically reset to *closed* so
    the next request acts as a probe against OpenAI.

    Returns:
        True if the breaker is open and callers should use Gemini fallback.
    """
    async with _cb.lock:
        if _cb.open:
            if time.monotonic() - _cb.last_failure_ts > _CB_RESET_AFTER_S:
                _cb.open = False
                _cb.failure_count = 0
                logger.info("[CB] Circuit breaker RESET — timeout elapsed")
        return _cb.open


async def _cb_record_failure() -> None:
    """Record one OpenAI failure and open the breaker after 5 consecutive failures.

    The breaker trips when ``failure_count`` reaches 5 — matching the spec
    in context.md §2 (pybreaker default).  Once open, all OpenAI calls are
    bypassed until the 60-second reset timer elapses.
    """
    async with _cb.lock:
        _cb.failure_count += 1
        _cb.last_failure_ts = time.monotonic()
        if _cb.failure_count >= 5:  # 5 consecutive failures per spec
            _cb.open = True
            logger.warning("[CB] Circuit breaker OPEN — switching to Gemini Flash fallback")


async def _cb_record_success() -> None:
    """Decrement the failure count on a successful OpenAI call.

    The breaker remains open until the reset timeout elapses; individual
    successes only reduce the failure counter to prevent premature tripping
    when occasional transient errors are mixed with successes.
    """
    async with _cb.lock:
        if _cb.failure_count > 0:
            _cb.failure_count -= 1


# ── Main orchestrator ─────────────────────────────────────────────
async def run_agent(
    request: ConciergeChatRequest,
    rag_sources: list[dict[str, Any]],
    venue_name: str,
    next_base_url: str = "http://localhost:3000",
) -> AgentTurnResult:
    """Execute one agent turn: moderate → detect language → RAG → GPT-4o loop → response.

    Falls back to Gemini Flash if:
    - The OpenAI circuit breaker is open (>= 5 consecutive failures), OR
    - OpenAI returns a retriable error (rate-limit, timeout, connection error), OR
    - The OpenAI call exceeds ``LLM_FALLBACK_TIMEOUT_MS`` (context.md §6).

    If ``finish_reason == "length"``, ``AgentTurnResult.truncated`` is set to
    ``True`` and ``"..."`` is appended to the response text per context.md §2.

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
    # Timeout in seconds derived from the spec env var (default 500 ms → 0.5 s)
    call_timeout_s: float = LLM_FALLBACK_TIMEOUT_MS / 1000.0

    # ── Moderation ────────────────────────────────────────────────
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

    # ── Language detection ────────────────────────────────────────
    lang = detect_language(request.message, request.language_code)

    # ── Build RAG context string ──────────────────────────────────
    rag_context = "\n\n".join(
        f"[{src['title']}]\n{src['excerpt']}" for src in rag_sources
    ) or "No specific venue context retrieved."

    no_rag = not rag_sources

    # ── Build system prompt ───────────────────────────────────────
    system = SYSTEM_PROMPT_TEMPLATE.format(
        venue_name=venue_name,
        language_code=lang,
        accessibility="ON — wheelchair accessible routes only" if request.accessibility else "OFF",
        rag_context=rag_context,
    )

    # ── Sanitize user input before LLM injection ──────────────────
    # Defense-in-depth: router already sanitized, but we re-sanitize here
    # to guard against any future code paths that bypass the router layer.
    safe_message = sanitize_input(request.message)

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user",   "content": safe_message},
    ]

    llm_provider = "openai"
    response_text = ""
    truncated = False

    # ── Circuit breaker check ─────────────────────────────────────
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

    # ── GPT-4o function-calling loop ──────────────────────────────
    # Python's for/else runs the else-block only when the loop completes
    # WITHOUT hitting a break.  Here the loop breaks on a non-tool-call
    # finish_reason (final answer found).  The else-block fires only when
    # all MAX_TOOL_ITERS iterations were consumed without a final answer,
    # at which point we send one last no-tools request to get a response.
    client = _openai_client

    try:
        for _iter in range(MAX_TOOL_ITERS + 1):
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=OPENAI_MODEL_PRIMARY,
                    messages=messages,
                    tools=TOOL_SCHEMAS,
                    tool_choice="auto",
                    temperature=TEMPERATURE,
                    max_tokens=LLM_MAX_TOKENS,
                ),
                timeout=call_timeout_s,
            )
            await _cb_record_success()

            choice = resp.choices[0]

            # ── Truncation detection (context.md §2) ──────────────
            # When finish_reason == "length", the model hit max_tokens.
            # Per spec: set truncated=True and append "..." to the text.
            if choice.finish_reason == "length":
                truncated = True

            # ── No more tool calls — we have the final answer ──────
            if choice.finish_reason not in ("tool_calls",):
                response_text = choice.message.content or ""
                if truncated:
                    response_text = response_text.rstrip() + "..."
                break

            # ── Process tool calls ────────────────────────────────
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

            # Append assistant turn + all tool results before next iteration
            messages.append({"role": "assistant", "content": None, "tool_calls": choice.message.tool_calls})
            messages.extend(tool_call_msgs)

        else:
            # Max tool iterations exceeded — ask the LLM for a final answer
            # without exposing any more tools to prevent further looping.
            logger.warning("[Orchestrator] Max tool iterations (%d) reached", MAX_TOOL_ITERS)
            messages.append({"role": "user", "content": "Please provide your final answer now."})
            final = await asyncio.wait_for(
                client.chat.completions.create(
                    model=OPENAI_MODEL_PRIMARY,
                    messages=messages,
                    temperature=TEMPERATURE,
                    max_tokens=LLM_MAX_TOKENS,
                ),
                timeout=call_timeout_s,
            )
            final_choice = final.choices[0]
            response_text = final_choice.message.content or ""
            if final_choice.finish_reason == "length":
                truncated = True
                response_text = response_text.rstrip() + "..."

    except asyncio.TimeoutError:
        # OpenAI call exceeded LLM_FALLBACK_TIMEOUT_MS — trigger Gemini fallback
        # per context.md §2 (fallback trigger: "exceeds LLM_FALLBACK_TIMEOUT_MS")
        await _cb_record_failure()
        logger.warning(
            "[Orchestrator] OpenAI call timed out after %.0f ms — failing over to Gemini",
            LLM_FALLBACK_TIMEOUT_MS,
        )
        response_text = await gemini_fallback(system, safe_message, rag_context)
        llm_provider = "gemini"
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
        truncated=truncated,
        total_latency_ms=int((time.monotonic() - start) * 1000),
        no_rag_context=no_rag,
    )
