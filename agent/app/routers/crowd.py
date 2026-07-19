"""Crowd analytics router — thin pass-through to Next.js /api/crowd for the agent."""
from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..config import NEXT_BASE_URL, VENUES
from ..tools import _http_client

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/crowd/{venue_id}")
async def get_crowd(venue_id: str) -> JSONResponse:
    """Proxy to the Next.js synthetic crowd generator.

    Args:
        venue_id: The venue identifier (must exist in VENUES whitelist).

    Returns:
        JSON crowd grid from the Next.js /api/crowd endpoint.

    Raises:
        HTTPException 400: When ``venue_id`` is not in the VENUES whitelist.
        JSONResponse 503: When the upstream Next.js service is unavailable.
    """
    if venue_id not in VENUES:
        raise HTTPException(status_code=400, detail=f"Unknown venueId: {venue_id!r}")
    try:
        resp = await _http_client.get(
            f"{NEXT_BASE_URL}/api/crowd",
            params={"venue": venue_id},
        )
        resp.raise_for_status()
        return JSONResponse(content=resp.json())
    except Exception as e:
        logger.error("[crowd] Proxy error for venue %r: %s", venue_id, e)
        return JSONResponse(
            content={"error": "Crowd data temporarily unavailable", "data": None},
            status_code=503,
        )
