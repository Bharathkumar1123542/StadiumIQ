"""
Chat router — POST /chat
Handles the full concierge request lifecycle:
  1. Validate & sanitize input
  2. RAG retrieval
  3. Agent orchestration
  4. Response serialization
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

from ..models import ConciergeChatRequest, AgentTurnResult
from ..rag import VectorStore
from ..orchestrator import run_agent, sanitize_input
from ..config import VENUES, NEXT_BASE_URL

logger = logging.getLogger(__name__)
router = APIRouter()


def _venue_name(venue_id: str) -> str:
    """Return the human-readable name for *venue_id*, or *venue_id* itself if unknown."""
    return VENUES.get(venue_id, {}).get("name", venue_id)


def _abbrev_session_id(session_id: str, max_chars: int = 8) -> str:
    """Return an abbreviated session ID safe for log output.

    Truncates to *max_chars* characters and appends ``…`` when the ID is
    longer, preventing excessively long log lines while retaining enough
    context for correlation.

    >>> _abbrev_session_id("sess_abc123xyz", 8)
    'sess_abc…'
    >>> _abbrev_session_id("short", 8)
    'short'
    """
    if len(session_id) > max_chars:
        return session_id[:max_chars] + "…"
    return session_id


@router.post("/chat", response_model=AgentTurnResult)
async def chat(raw: Request) -> JSONResponse:
    """Process a fan concierge chat turn.

    Steps:
      1. Parse and validate the JSON request body.
      2. Enforce message length guard (pre-sanitization so HTML tags cannot
         shrink a long message below the cap).
      3. Sanitize user input at the boundary (defense-in-depth — orchestrator
         also sanitizes before LLM injection).
      4. Validate venue ID against the whitelist.
      5. Retrieve relevant context from the RAG vector store.
      6. Execute the agent orchestration loop.
      7. Serialize and return the response with ``Cache-Control: no-store``.

    Returns:
        JSON-encoded :class:`AgentTurnResult` with camelCase field aliases for
        TypeScript compatibility.

    Raises:
        HTTPException 400: On invalid/missing body, oversized message, empty
                           post-sanitization message, or unknown venue ID.
    """
    # Parse body
    try:
        body = await raw.json()
        req = ConciergeChatRequest.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc

    # Input length guard — before sanitize so tags cannot shrink a long message below the cap
    if len(req.message) > 1000:
        raise HTTPException(status_code=400, detail="Message too long (max 1000 chars)")

    # Sanitize input at boundary (defense-in-depth — orchestrator also sanitizes)
    req.message = sanitize_input(req.message)

    if not req.message:
        raise HTTPException(status_code=400, detail="Message must not be empty after sanitization")

    # Venue whitelist
    if req.venue_id not in VENUES:
        raise HTTPException(status_code=400, detail=f"Unknown venueId: {req.venue_id!r}")

    # RAG retrieval
    vector_store: VectorStore = raw.app.state.vector_store
    rag_docs = vector_store.search(
        query=req.message,
        venue_id=req.venue_id,
        top_k=3,
    )

    logger.info(
        "[chat] session=%r venue=%r lang=%r rag_hits=%d",
        _abbrev_session_id(req.session_id),
        req.venue_id,
        req.language_code,
        len(rag_docs),
    )

    # Run agent
    result = await run_agent(
        request=req,
        rag_sources=rag_docs,
        venue_name=_venue_name(req.venue_id),
        next_base_url=NEXT_BASE_URL,
    )

    logger.info(
        "[chat] done session=%r provider=%r latency_ms=%d",
        _abbrev_session_id(req.session_id),
        result.llm_provider,
        result.total_latency_ms,
    )

    # Serialize with camelCase alias for TypeScript frontend
    return JSONResponse(
        content=result.model_dump(by_alias=True, exclude_none=True),
        headers={"Cache-Control": "no-store"},
    )
