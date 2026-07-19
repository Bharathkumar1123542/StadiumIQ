"""
StadiumIQ Python Agent — FastAPI entry point
Handles fan concierge requests via GPT-4o function-calling + RAG + circuit breaker
"""
import logging
import logging.config
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .routers import chat, crowd
from .rag import VectorStore
from .tools import close_http_client
from .config import CORS_ORIGINS

# ── Logging configuration ─────────────────────────────────────────
logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "root": {
        "level": "INFO",
        "handlers": ["console"],
    },
})

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown of shared resources.

    Startup:
      - Pre-loads the RAG vector store so the first request is not penalised
        by cold-start embedding time.

    Shutdown:
      - Closes the shared httpx AsyncClient to release pooled TCP connections
        cleanly before the process exits.
    """
    logger.info("[StadiumIQ] Loading RAG vector store…")
    store = VectorStore()
    await store.build_index()
    app.state.vector_store = store
    logger.info("[StadiumIQ] Vector store ready — %d chunks indexed", store.doc_count)
    try:
        yield
    finally:
        logger.info("[StadiumIQ] Agent shutting down — closing HTTP client")
        await close_http_client()


app = FastAPI(
    title="StadiumIQ Agent",
    description="GenAI concierge backend for FIFA World Cup 2026",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,  # Configurable via CORS_ORIGINS env var
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.include_router(chat.router)
app.include_router(crowd.router)


@app.get("/health")
async def health_check():
    """Return service health including RAG index status and circuit breaker state."""
    from .orchestrator import get_circuit_breaker_state
    store: VectorStore = app.state.vector_store
    cb_state = get_circuit_breaker_state()
    return {
        "status": "ok",
        "rag_chunks": store.doc_count,
        "circuit_breaker": "open" if cb_state["open"] else "closed",
        "circuit_breaker_detail": cb_state,
    }
