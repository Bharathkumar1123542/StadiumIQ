"""
Agent tool definitions — GPT-4o function-calling schemas and executors.
Each tool has:
  - A JSON schema for the LLM's function-calling list
  - An async executor that calls the appropriate internal or external service
"""
from __future__ import annotations

import logging
import time
import httpx
from typing import Any
from .models import ToolCallResult  # noqa: F401 — re-exported for convenience

logger = logging.getLogger(__name__)

# Shared async HTTP client — reuses connection pool across tool calls
# (avoids a new TCP handshake per crowd_density / emergency_escalate call)
_http_client = httpx.AsyncClient(timeout=5.0)

# ── Tool JSON schemas (sent to GPT-4o in every request) ──────────

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "crowd_density",
            "description": (
                "Get the current crowd density and choke probability for a specific "
                "zone or the entire venue. Use this when a fan asks about crowd levels, "
                "wait times, or congestion, OR when recommending a route to any destination."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "venue_id": {
                        "type": "string",
                        "description": "The venue identifier, e.g. 'metlife'",
                    },
                    "zone_id": {
                        "type": "string",
                        "description": "Optional specific zone ID, e.g. 'zone_2'. Omit for venue-wide summary.",
                    },
                },
                "required": ["venue_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "accessibility_route",
            "description": (
                "Generate a step-by-step accessible or standard route between two zones. "
                "Always call this when the fan asks about getting somewhere AND "
                "accessibility=true is set, or when the crowd_density tool indicates "
                "the direct path is congested."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "venue_id":       {"type": "string"},
                    "from_zone":      {"type": "string", "description": "Current fan zone ID"},
                    "to_destination": {
                        "type": "string",
                        "description": "Destination description, e.g. 'nearest restroom', 'Gate A', 'first aid'",
                    },
                    "accessibility":  {
                        "type": "boolean",
                        "description": "If true, only return wheelchair/mobility accessible routes",
                    },
                },
                "required": ["venue_id", "to_destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "emergency_escalate",
            "description": (
                "Create a priority escalation ticket visible on the staff ops dashboard. "
                "Call this immediately if the fan mentions: medical emergency, lost child, "
                "security threat, fire, injury, or any life-safety situation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "venue_id":     {"type": "string"},
                    "session_id":   {"type": "string"},
                    "priority":     {"type": "string", "enum": ["high", "critical"]},
                    "summary":      {"type": "string", "description": "2-sentence summary of the situation in English"},
                    "language_code": {"type": "string", "description": "Fan's language code"},
                },
                "required": ["venue_id", "session_id", "priority", "summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "venue_search",
            "description": (
                "Search the venue knowledge base for information about facilities, schedules, "
                "policies, or any venue-specific question when the answer is not already "
                "in the retrieved context."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query":    {"type": "string"},
                    "venue_id": {"type": "string"},
                },
                "required": ["query", "venue_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_lookup",
            "description": (
                "Look up the match schedule for a specific venue, including kickoff times, "
                "teams, and group/round information. Use when a fan asks about upcoming "
                "matches, game times, or tournament schedule."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "venue_id": {"type": "string", "description": "The venue identifier"},
                    "date": {"type": "string", "description": "Optional date filter, e.g. 'today', '2026-07-20'"},
                },
                "required": ["venue_id"],
            },
        },
    },
]


# ── Tool executors ────────────────────────────────────────────────

async def execute_crowd_density(args: dict[str, Any], next_base_url: str) -> dict[str, Any]:
    """Calls the Next.js /api/crowd route (our synthetic LSTM sim).

    Args:
        args:          Tool arguments from GPT-4o; expects ``venue_id`` and
                       optional ``zone_id``.
        next_base_url: Base URL of the Next.js service.

    Returns:
        A dict with keys ``venue_id``, ``avg_density``, ``max_choke_prob``,
        ``crowded_zones``, ``degraded_mode``, and ``latency_ms``.
    """
    t0 = time.monotonic()
    venue_id = args.get("venue_id", "metlife")
    zone_id  = args.get("zone_id")

    resp = await _http_client.get(f"{next_base_url}/api/crowd", params={"venue": venue_id})
    resp.raise_for_status()
    grid = resp.json().get("data", {})

    cells = [c for row in grid.get("cells", []) for c in row]
    if zone_id:
        cells = [c for c in cells if c.get("zoneId") == zone_id]

    if not cells:
        return {"status": "no_data", "latency_ms": int((time.monotonic() - t0) * 1000)}

    online = [c for c in cells if c.get("cameraOnline")]
    if not online:
        return {"status": "all_cameras_down", "latency_ms": int((time.monotonic() - t0) * 1000)}

    avg_density = sum(c["density"] for c in online) / len(online)
    max_choke   = max((c.get("chokeProbability") or 0) for c in online)
    crowded_zones = [
        c["zoneName"] for c in online
        if (c.get("chokeProbability") or 0) > 0.75
    ]

    return {
        "venue_id":      venue_id,
        "zone_filter":   zone_id,
        "avg_density":   round(avg_density, 2),
        "max_choke_prob": round(max_choke, 3),
        "crowded_zones": crowded_zones[:3],
        "degraded_mode": grid.get("degradedMode", False),
        "latency_ms":    int((time.monotonic() - t0) * 1000),
    }


async def execute_accessibility_route(args: dict[str, Any]) -> dict[str, Any]:
    """Return a step-by-step route to the requested destination.

    In the demo this returns hardcoded accessible routes.
    In production: calls a graph-search service over the venue's BLE-beacon floor plan.

    Args:
        args: Tool arguments; expects ``to_destination`` and optionally
              ``from_zone`` and ``accessibility``.

    Returns:
        A dict with keys ``route_id``, ``to_destination``, ``steps``,
        ``estimated_minutes``, ``is_accessible``, and ``crowd_level``.
    """
    destination = args.get("to_destination", "").lower()
    accessible  = args.get("accessibility", False)

    # Demo routes
    if "restroom" in destination or "bathroom" in destination or "toilet" in destination:
        return {
            "route_id": "route_demo_restroom_c2",
            "to_destination": "Gate C Level 2 Restrooms",
            "steps": [
                {"step_index": 0, "instruction": "Head toward Gate C ramp (follow blue ♿ signs)", "landmark": "Giant screen on right", "floor": 3, "distance_metres": 45},
                {"step_index": 1, "instruction": "Take elevator (accessible) or ramp down to Level 2", "landmark": "Elevator bank near concession stand 24", "floor": 2, "distance_metres": 20},
                {"step_index": 2, "instruction": "Restrooms are 15m ahead on the left", "landmark": "Gate C restroom signage", "floor": 2, "distance_metres": 15},
            ],
            "estimated_minutes": 4,
            "is_accessible": accessible,
            "crowd_level": "low",
        }

    if "gate a" in destination or "exit" in destination:
        return {
            "route_id": "route_demo_gate_a",
            "to_destination": "Gate A (Main Exit)",
            "steps": [
                {"step_index": 0, "instruction": "Walk north along main concourse Level 2", "landmark": "Food court on left", "floor": 2, "distance_metres": 120},
                {"step_index": 1, "instruction": "Follow Gate A signs at junction", "landmark": "Giant FIFA banner", "floor": 2, "distance_metres": 40},
            ],
            "estimated_minutes": 3,
            "is_accessible": accessible,
            "crowd_level": "moderate",
        }

    # Generic fallback
    return {
        "route_id": "route_demo_generic",
        "to_destination": args.get("to_destination", "Destination"),
        "steps": [
            {"step_index": 0, "instruction": "Head to nearest Info Kiosk (blue signage) for specific directions", "landmark": "Info Kiosk", "floor": 2, "distance_metres": 30},
        ],
        "estimated_minutes": 2,
        "is_accessible": accessible,
        "crowd_level": "unknown",
    }


async def execute_emergency_escalate(args: dict[str, Any], next_base_url: str) -> dict[str, Any]:
    """Create an escalation ticket via Next.js /api/escalate.

    Args:
        args:          Tool arguments; expects ``session_id``, ``venue_id``,
                       ``summary``, and optionally ``language_code``/``zone_id``.
        next_base_url: Base URL of the Next.js service.

    Returns:
        A dict including ``success``, ``dispatched_at``, and ``eta_minutes``.
    """
    t0 = time.monotonic()
    try:
        resp = await _http_client.post(
            f"{next_base_url}/api/escalate",
            json={
                "sessionId": args.get("session_id", "unknown"),
                "venueId":   args.get("venue_id", "metlife"),
                "zoneId":    args.get("zone_id"),
                "languageCode": args.get("language_code", "en"),
                "triggerMessage": args.get("summary", "Emergency escalation"),
            },
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
    except Exception as e:
        logger.error("[Tool:emergency_escalate] HTTP call failed: %s", e)
        data = {"success": False, "error": str(e)}

    return {
        **data,
        "dispatched_at": time.strftime("%H:%M:%S"),
        "eta_minutes":   3,
        "latency_ms":    int((time.monotonic() - t0) * 1000),
    }


async def execute_schedule_lookup(args: dict[str, Any]) -> dict[str, Any]:
    """Return demo match schedule data for a venue.

    In production: queries the FIFA schedule API.

    Args:
        args: Tool arguments; expects ``venue_id`` and optional ``date``.

    Returns:
        A dict with keys ``venue_id``, ``matches``, and ``note``.
    """
    venue_id = args.get("venue_id", "metlife")
    return {
        "venue_id": venue_id,
        "matches": [
            {
                "match_id": "match_g1_01",
                "round": "Group Stage — Group A",
                "home": "Mexico",
                "away": "Canada",
                "kickoff": "2026-06-11T18:00:00-04:00",
                "status": "scheduled",
            },
            {
                "match_id": "match_g2_03",
                "round": "Group Stage — Group C",
                "home": "USA",
                "away": "England",
                "kickoff": "2026-06-15T20:00:00-04:00",
                "status": "scheduled",
            },
        ],
        "note": "Schedule is subject to change. Check official FIFA app for latest updates.",
    }


# ── Dispatcher ───────────────────────────────────────────────────

async def dispatch_tool(
    tool_name: str,
    args: dict[str, Any],
    next_base_url: str = "http://localhost:3000",
) -> tuple[dict[str, Any], int]:
    """Route a tool call to the correct executor.

    Args:
        tool_name:     One of the registered tool names.
        args:          Tool arguments parsed from GPT-4o function call JSON.
        next_base_url: Base URL of the Next.js service (used by HTTP-backed tools).

    Returns:
        A ``(result_dict, latency_ms)`` tuple. ``result_dict`` will contain
        an ``"error"`` key if the tool executor raises an exception.
    """
    t0 = time.monotonic()
    result: dict[str, Any]
    try:
        if tool_name == "crowd_density":
            result = await execute_crowd_density(args, next_base_url)
        elif tool_name == "accessibility_route":
            result = await execute_accessibility_route(args)
        elif tool_name == "emergency_escalate":
            result = await execute_emergency_escalate(args, next_base_url)
        elif tool_name == "venue_search":
            # venue_search supplements RAG when the initial retrieval didn't cover the query
            result = {
                "status": "supplementary_search",
                "note": "The venue knowledge base has been searched. Use the retrieved context in the system prompt to answer.",
            }
        elif tool_name == "schedule_lookup":
            result = await execute_schedule_lookup(args)
        else:
            logger.warning("[Tool:dispatch] Unknown tool requested: %r", tool_name)
            result = {"error": f"Unknown tool: {tool_name}"}
    except Exception as e:
        logger.error("[Tool:dispatch] Tool %r raised an exception: %s", tool_name, e)
        result = {"error": str(e)}

    latency_ms = int((time.monotonic() - t0) * 1000)
    return result, latency_ms
