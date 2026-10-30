"""Chat route — POST /api/chat.

Thin controller: validates input, calls AssistantService, maps the domain
response to the API schema.  Zero business logic here.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.application.services.assistant_service import AssistantService
from app.domain.exceptions.assistant_exceptions import ConfigurationError, ProviderError
from app.domain.models.chat import AssistantRequest, ChatTurn
from schemas import ChatRequest, ChatResponse, Source

router = APIRouter()


def _to_domain_request(api_req: ChatRequest) -> AssistantRequest:
    return AssistantRequest(
        message=api_req.message,
        history=[ChatTurn(role=t.role, content=t.content) for t in api_req.history],
        session_id=api_req.session_id,
        channel="text",
    )


def chat_router(assistant: AssistantService) -> APIRouter:
    """Factory that binds the route handler to a specific AssistantService instance."""

    @router.post("/api/chat", response_model=ChatResponse)
    def chat(request: ChatRequest) -> ChatResponse:
        try:
            result = assistant.answer(_to_domain_request(request))
        except ConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ProviderError as exc:
            raise HTTPException(
                status_code=502,
                detail="The assistant service is temporarily unavailable.",
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail="The assistant service is temporarily unavailable.",
            ) from exc

        return ChatResponse(
            session_id=result.session_id,
            answer=result.answer,
            sources=[Source(title=s.title, category=s.category) for s in result.sources],
            confidence=result.confidence,  # type: ignore[arg-type]
        )

    return router
