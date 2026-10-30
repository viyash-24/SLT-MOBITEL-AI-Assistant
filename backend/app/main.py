"""SLT-MOBITEL AI Assistant — FastAPI application factory.

This module wires the Clean Architecture layers together:

  Domain → Application → Infrastructure → API

All routes are thin controllers that delegate to AssistantService.
The existing `backend/main.py` is preserved for backward compatibility
during migration; this file is the new recommended entry point.

Run with:
    uvicorn app.main:app --reload --app-dir backend
  or:
    uvicorn app.main:app --reload   (from inside backend/)
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.chat import chat_router
from app.api.routes.health import health_router
from app.api.routes.knowledge import knowledge_router
from app.api.routes.livekit import livekit_router
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
        "Clean Architecture refactor. Text chat and voice agent share the same "
        "AssistantService → VectorStore → LLM pipeline."
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
app.include_router(livekit_router(settings))
app.include_router(knowledge_router(_rag))
