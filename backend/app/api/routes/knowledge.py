"""Knowledge base management route — POST /api/knowledge/reindex."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter()


def knowledge_router(rag_service) -> APIRouter:
    """Factory: binds reindex endpoint to the shared rag_service."""

    @router.post("/api/knowledge/reindex")
    def reindex() -> dict:
        try:
            count = rag_service.reindex()
            return {"status": "indexed", "documents": count}
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(
                status_code=502, detail="Knowledge base indexing failed"
            ) from error

    return router
