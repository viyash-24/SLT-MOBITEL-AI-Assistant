from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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
