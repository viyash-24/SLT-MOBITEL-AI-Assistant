"""SLT-MOBITEL AI Assistant — FastAPI application factory.

This module wires the Clean Architecture layers together:

  Domain → Application → Infrastructure → API

Text chat delegates to AssistantService; voice delegates exclusively to Tavus
CVI. `backend/main.py` re-exports this application for backward compatibility.

Run with:
    uvicorn app.main:app --reload --app-dir backend
  or:
    uvicorn app.main:app --reload   (from inside backend/)
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.chat import chat_router
from app.api.routes.health import health_router
from app.api.routes.knowledge import knowledge_router
from app.api.routes.tavus import tavus_router
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
        "SLT-MOBITEL text chat and embedded Tavus avatar assistant. "
        "Tavus exclusively owns microphone input, speech, and synchronized video."
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
app.include_router(tavus_router(settings))


@app.websocket("/api/voice/live")
async def retired_gemini_voice(websocket: WebSocket) -> None:
    """Prevent stale clients from starting a second, independent speaking agent."""
    await websocket.accept()
    await websocket.send_json({
        "type": "error",
        "message": "Voice now uses the Tavus avatar. Refresh the voice page to reconnect.",
    })
    await websocket.close(code=1008)


# Compatibility fallback for any stale browser tabs requesting the legacy LiveKit token
@app.api_route("/api/livekit/token", methods=["GET", "POST", "OPTIONS"])
def livekit_token_deprecated() -> None:
    raise HTTPException(
        status_code=410,
        detail="Voice now uses the Tavus avatar. Refresh the voice page to reconnect.",
    )

