from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from livekit import api
from pydantic import BaseModel, Field
from uuid import uuid4

from config import get_settings
from rag import KNOWLEDGE_BASE, get_rag_service
from schemas import ChatRequest, ChatResponse, HealthResponse

settings = get_settings()
app = FastAPI(title="SLT-MOBITEL AI Assistant API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LiveKitTokenRequest(BaseModel):
    room: str | None = Field(default=None, min_length=1, max_length=100)
    language: str = Field(default="EN", min_length=2, max_length=10)


class LiveKitTokenResponse(BaseModel):
    token: str
    url: str
    room: str
    language: str


@app.post("/api/livekit/token", response_model=LiveKitTokenResponse)
def livekit_token(request: LiveKitTokenRequest) -> LiveKitTokenResponse:
    livekit_api_key = settings.livekit_api_key.strip()
    livekit_api_secret = settings.livekit_api_secret.strip()
    livekit_url = settings.livekit_url.strip().rstrip("/")
    missing = [
        name
        for name, value in (
            ("LIVEKIT_API_KEY", livekit_api_key),
            ("LIVEKIT_API_SECRET", livekit_api_secret),
            ("LIVEKIT_URL", livekit_url),
        )
        if not value.strip()
    ]
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"LiveKit is not configured. Missing: {', '.join(missing)}.",
        )
    if any(char in livekit_api_secret or char in livekit_api_key for char in ("•", "●", "·", "*")):
        raise HTTPException(
            status_code=500,
            detail="LIVEKIT_API_SECRET or LIVEKIT_API_KEY contains masked bullet/placeholder characters. Copy the real secret directly from the LiveKit Cloud dashboard.",
        )
    if not livekit_url.startswith(("wss://", "ws://")):
        raise HTTPException(
            status_code=503,
            detail="LIVEKIT_URL must start with wss:// (or ws:// for local development).",
        )

    room = request.room or f"{settings.livekit_room}-{request.language.lower()}-{uuid4().hex[:8]}"
    identity = f"customer-{uuid4().hex[:12]}"
    token = (
        api.AccessToken(livekit_api_key, livekit_api_secret)
        .with_identity(identity)
        .with_name("SLT-MOBITEL customer")
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
            )
        )
    )
    return LiveKitTokenResponse(
        token=token.to_jwt(),
        url=livekit_url,
        room=room,
        language=request.language.upper(),
    )


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    rag_service = get_rag_service()
    database_is_ready = rag_service.database_ready()
    return HealthResponse(
        status="ok" if database_is_ready and settings.google_api_key else "degraded",
        gemini_configured=bool(settings.google_api_key),
        database_configured=settings.database_configured,
        database_ready=database_is_ready,
        knowledge_base_documents=len(KNOWLEDGE_BASE),
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    try:
        return get_rag_service().chat(request)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail="The assistant service is temporarily unavailable") from error


@app.post("/api/knowledge/reindex")
def reindex() -> dict[str, int | str]:
    try:
        count = get_rag_service().reindex()
        return {"status": "indexed", "documents": count}
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail="Knowledge base indexing failed") from error


