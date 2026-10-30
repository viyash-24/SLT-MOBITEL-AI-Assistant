"""Health route — GET /api/health."""
from __future__ import annotations

from fastapi import APIRouter

from schemas import HealthResponse

router = APIRouter()


def health_router(settings, rag_service, knowledge_base_count: int) -> APIRouter:
    """Factory: binds health check to live settings + rag_service."""

    @router.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        database_is_ready = rag_service.database_ready()
        return HealthResponse(
            status="ok" if database_is_ready and settings.google_api_key else "degraded",
            gemini_configured=bool(settings.google_api_key),
            database_configured=settings.database_configured,
            database_ready=database_is_ready,
            knowledge_base_documents=knowledge_base_count,
        )

    return router
