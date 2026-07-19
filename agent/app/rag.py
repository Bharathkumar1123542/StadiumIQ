"""
RAG vector store — uses chromadb (local, in-process) with OpenAI embeddings.
Falls back to TF-IDF keyword matching if OpenAI embedding API is unavailable.
"""
from __future__ import annotations

import logging
import os
import json
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    import chromadb

logger = logging.getLogger(__name__)

# ── Venue knowledge documents (embedded at startup) ───────────────
DOCS_DIR = Path(__file__).parent.parent / "data" / "venue_docs"

# Each doc: {id, title, content, venueId}
INLINE_DOCS: list[dict[str, Any]] = [
    {
        "id": "doc_metlife_restrooms",
        "title": "MetLife Stadium — Restroom Locations Guide",
        "venueId": "metlife",
        "content": (
            "MetLife Stadium restroom locations: "
            "Level 1 restrooms are at Gates A (section 101 side), C (section 106), and D. "
            "Level 2 restrooms are adjacent to Gate C north side and Gate E south side. "
            "Level 3 restrooms near section 312 are accessible via the main concourse ramp — "
            "note that Level 3 becomes congested 5 minutes after kickoff; "
            "preferred alternative is Gate C Level 2 restrooms (4 min walk from section 312). "
            "Family restrooms with changing tables are on Level 1 at Gates A and E."
        ),
    },
    {
        "id": "doc_metlife_accessibility",
        "title": "MetLife Stadium — Accessibility & ADA Compliance 2026",
        "venueId": "metlife",
        "content": (
            "Wheelchair and mobility-assisted access: "
            "Elevator banks at Gates A, C, and E serve all four levels. "
            "Accessible seating is available in sections 102, 204, and 318 (all ADA-compliant rows). "
            "Accessible restrooms on every level adjacent to elevators. "
            "Personal assistance: visit any blue-marked Info Kiosk for volunteer dispatch within 5 minutes. "
            "Hearing loop systems installed in premium areas. "
            "Guide dog relief areas at Gates A and D exterior plazas."
        ),
    },
    {
        "id": "doc_metlife_concessions",
        "title": "MetLife Stadium — Concession Hours & Locations",
        "venueId": "metlife",
        "content": (
            "Concession stands open 2 hours before kickoff and close at final whistle. "
            "Halftime extended hours apply at Level 2 stands only. "
            "Halal-certified food options at stands H2 (Level 2, Gate C), H4 (Level 3, Gate A). "
            "Vegetarian/vegan options at Green Stands (marked with leaf icon) on Levels 1 and 2. "
            "Kosher options by pre-order only — inquire at Guest Services Level 1. "
            "Alcohol sales end 15 minutes before final whistle per FIFA 2026 regulations."
        ),
    },
    {
        "id": "doc_ops_crowd_protocol",
        "title": "Crowd Management Protocol v3.1 — FIFA 2026",
        "venueId": "all",
        "content": (
            "Crowd density thresholds: "
            "Level 1 Advisory: 2.5–3.0 p/m² — advisory messaging via app. "
            "Level 2 Warning: 3.0–4.0 p/m² — redirect fans to alternate routes, notify stewards. "
            "Level 3 Critical: >4.0 p/m² — mandatory reroute via AR overlay, dispatch stewards, consider zone closure. "
            "Gate C Level 2 serves as primary overflow for sections 310–320 when north concourse exceeds 3.5 p/m². "
            "Emergency assembly points: Parking Lot B (east), MetLife Plaza (west). "
            "Medical posts at Gates A and D, staffed 2h pre-match through 1h post-match."
        ),
    },
    {
        "id": "doc_transport_2026",
        "title": "FIFA World Cup 2026 — MetLife Transportation Guide",
        "venueId": "metlife",
        "content": (
            "Public transit: NJ Transit trains run from Penn Station New York every 15 minutes on match days. "
            "Last train departs MetLife station 90 minutes after final whistle. "
            "Bus shuttles from Meadowlands: Routes M1, M2, M3 every 8 minutes. "
            "Rideshare drop-off zones: Zone R1 (Gate A side), Zone R2 (Gate D side) — do not use standard parking entrance. "
            "Park-and-ride lots open 4 hours before kickoff. Lot B (nearest) fills first — arrive early. "
            "Accessible parking pre-booking required via FIFA 2026 official app."
        ),
    },
]


class VectorStore:
    """Chroma-backed RAG store with OpenAI embeddings + TF-IDF fallback.

    Usage::

        store = VectorStore()
        await store.build_index()
        results = store.search("nearest restroom", venue_id="metlife", top_k=3)
    """

    def __init__(self) -> None:
        self._chroma_collection: Any = None
        self._fallback_docs: list[dict[str, Any]] = []
        self.doc_count: int = 0
        self._use_fallback: bool = False

    async def build_index(self) -> None:
        """Index all documents. Called once at startup."""
        docs: list[dict[str, Any]] = list(INLINE_DOCS)

        # Also load any .json files from the data/venue_docs directory
        if DOCS_DIR.exists():
            for path in DOCS_DIR.glob("*.json"):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    docs.append(data)
                except (OSError, json.JSONDecodeError, ValueError) as e:
                    logger.warning("[RAG] Skipping %s: %s", path.name, e)

        try:
            import chromadb
            from chromadb.utils import embedding_functions

            chroma_client = chromadb.Client()

            openai_key = os.getenv("OPENAI_API_KEY")
            if openai_key:
                ef = embedding_functions.OpenAIEmbeddingFunction(
                    api_key=openai_key,
                    model_name="text-embedding-3-small",
                )
            else:
                # Use Chroma's default sentence-transformer embeddings (no API key needed)
                ef = embedding_functions.DefaultEmbeddingFunction()

            self._chroma_collection = chroma_client.get_or_create_collection(
                name="stadiumiq_venue_docs",
                embedding_function=ef,
            )

            # Upsert all docs
            self._chroma_collection.upsert(
                ids=[d["id"] for d in docs],
                documents=[d["content"] for d in docs],
                metadatas=[
                    {"title": d["title"], "venueId": d.get("venueId", "all")}
                    for d in docs
                ],
            )

        except ImportError:
            logger.warning("[RAG] chromadb not installed — using TF-IDF keyword fallback")
            self._use_fallback = True
        except Exception as e:
            logger.error("[RAG] Chroma setup failed (%s) — using TF-IDF keyword fallback", e)
            self._use_fallback = True

        self._fallback_docs = docs
        self.doc_count = len(docs)

    def search(self, query: str, venue_id: str, top_k: int = 3) -> list[dict[str, Any]]:
        """Return top-k documents most relevant to *query* for *venue_id*.

        Args:
            query:    The fan's question or search text.
            venue_id: The venue identifier (e.g. ``"metlife"``).
            top_k:    Maximum number of documents to return.

        Returns:
            A list of result dicts with keys
            ``document_id``, ``title``, ``excerpt``, and ``score``.
        """
        if self._use_fallback or self._chroma_collection is None:
            return self._keyword_search(query, venue_id, top_k)

        try:
            results = self._chroma_collection.query(
                query_texts=[query],
                n_results=top_k,
                where={"$or": [
                    {"venueId": {"$eq": venue_id}},
                    {"venueId": {"$eq": "all"}},
                ]},
            )
            output: list[dict[str, Any]] = []
            for i, (doc_id, doc, meta, dist) in enumerate(zip(
                results["ids"][0],
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
            )):
                # Chroma returns L2 distance; convert to cosine similarity approx
                score = max(0.0, 1.0 - dist / 2.0)
                output.append({
                    "document_id": doc_id,
                    "title": meta["title"],
                    "excerpt": doc[:200],
                    "score": round(score, 3),
                })
            return output
        except Exception as e:
            logger.error("[RAG] Chroma query failed (%s) — falling back to keyword search", e)
            return self._keyword_search(query, venue_id, top_k)

    def _keyword_search(self, query: str, venue_id: str, top_k: int) -> list[dict[str, Any]]:
        """TF-IDF-lite keyword overlap scoring — graceful degradation.

        >>> store = VectorStore()
        >>> store._fallback_docs = [{"id": "d1", "venueId": "metlife", "title": "T", "content": "restroom gate level"}]
        >>> results = store._keyword_search("restroom", "metlife", 3)
        >>> len(results) == 1 and results[0]["document_id"] == "d1"
        True
        """
        query_tokens = set(query.lower().split())
        scored: list[tuple[float, dict[str, Any]]] = []
        for doc in self._fallback_docs:
            if doc.get("venueId") not in (venue_id, "all"):
                continue
            content_tokens = set(doc["content"].lower().split())
            overlap = len(query_tokens & content_tokens)
            score = overlap / max(len(query_tokens), 1)
            if score > 0:
                scored.append((score, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            {
                "document_id": d["id"],
                "title": d["title"],
                "excerpt": d["content"][:200],
                "score": round(s, 3),
            }
            for s, d in scored[:top_k]
        ]
