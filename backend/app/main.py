"""SLT-MOBITEL AI Assistant — FastAPI application factory.

This module wires the Clean Architecture layers together:

  Domain → Application → Infrastructure → API

Text chat delegates to AssistantService; live voice assistant connects to
Google Gemini Live API with real-time speech and facial animation.

Run with:
    uvicorn app.main:app --reload --app-dir backend
  or:
    uvicorn app.main:app --reload   (from inside backend/)
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.chat import chat_router
from app.api.routes.health import health_router
from app.api.routes.knowledge import knowledge_router
from app.api.routes.voice_live import voice_live_router
from app.dependencies import get_assistant_service
from config import get_settings
from rag import KNOWLEDGE_BASE, get_rag_service

settings = get_settings()
_assistant = get_assistant_service()
_rag = get_rag_service()

app = FastAPI(
    title="SLT-MOBITEL AI Assistant API",
    version="2.0.0",
    description=(
        "SLT-MOBITEL text chat and live animated avatar voice assistant. "
        "Text chat and voice assistant share the same AssistantService → VectorStore → LLM pipeline."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers (each is a thin factory wrapping its handler)
app.include_router(chat_router(_assistant))
app.include_router(health_router(settings, _rag, len(KNOWLEDGE_BASE)))
app.include_router(knowledge_router(_rag))
app.include_router(voice_live_router(_assistant, settings))


# Compatibility fallback for any stale browser tabs requesting the legacy LiveKit token
@app.api_route("/api/livekit/token", methods=["GET", "POST", "OPTIONS"])
def livekit_token_deprecated() -> None:
    raise HTTPException(
        status_code=410,
        detail="LiveKit has been replaced by Google Gemini Live API. Please refresh your browser.",
    )
