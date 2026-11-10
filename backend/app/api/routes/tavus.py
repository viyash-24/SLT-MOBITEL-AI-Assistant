"""Tavus CVI (Conversational Video Interface) routes.

Provides two thin proxy endpoints that keep the TAVUS_API_KEY safely on the
server so it is never exposed to the browser:

  POST  /api/tavus/conversation       — create a new Tavus conversation session
  POST  /api/tavus/conversation/end   — end / delete an active session
  GET   /api/tavus/status             — returns whether Tavus is configured

The browser joins `conversation_url` with the Daily call object and renders
the avatar's audio/video tracks directly in the app. There is no second voice
pipeline or hosted call-room UI.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import Settings

logger = logging.getLogger(__name__)

_TAVUS_BASE = "https://tavusapi.com"
_ASSISTANT_CONTEXT = (
    "You are SLT Avatar, the application's only SLT-MOBITEL voice assistant. "
    "Introduce yourself only as SLT Avatar. Do not use a personal name. "
    "Answer warmly and concisely using the verified SLT-MOBITEL knowledge attached "
    "to your PAL. Never invent package prices, allowances, eligibility, or account "
    "details. If the knowledge does not answer a question, say so and direct the "
    "customer to SLT support at 1212. Do not claim to access the customer's account. "
    "Use natural spoken sentences without markdown."
)


def _post_to_tavus(url: str, **kwargs: Any) -> httpx.Response:
    """Provider-only HTTP seam; tests must not patch TestClient's HTTP methods."""
    with httpx.Client(timeout=30.0) as client:
        return client.post(url, **kwargs)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class CreateConversationRequest(BaseModel):
    """Optional body fields the frontend can pass when starting a session."""

    conversational_context: str = Field(default="", max_length=8000)
    custom_greeting: str = Field(default="", max_length=1000)
    conversation_name: str = Field(default="SLT-MOBITEL AI Voice Session", max_length=200)
    language: Literal["EN", "SI", "TA"] = "EN"


class CreateConversationResponse(BaseModel):
    conversation_id: str
    conversation_url: str
    status: str
    meeting_token: str | None = None


class EndConversationRequest(BaseModel):
    conversation_id: str = Field(max_length=256)


class TavusStatusResponse(BaseModel):
    configured: bool
    has_pal: bool
    detail: str | None = None


# ---------------------------------------------------------------------------
# Route factory (mirrors the pattern used by the other route modules)
# ---------------------------------------------------------------------------


def tavus_router(settings: Settings) -> APIRouter:
    """Return an APIRouter bound to *settings*.

    Missing configuration fails explicitly. A stock persona or separate audio
    assistant must never silently replace the application's configured PAL.
    """
    router = APIRouter()

    def _headers() -> dict[str, str]:
        return {
            "x-api-key": settings.tavus_api_key,
            "Content-Type": "application/json",
        }

    def _configuration_error(*, require_pal: bool = True) -> str | None:
        missing = []
        if not settings.tavus_api_key.strip():
            missing.append("TAVUS_API_KEY")
        if require_pal and not settings.tavus_pal_id.strip():
            missing.append("TAVUS_PAL_ID")
        if missing:
            return f"Tavus is not configured. Set {' and '.join(missing)} in backend/.env."
        return None

    def _require_configuration(*, require_pal: bool = True) -> None:
        error = _configuration_error(require_pal=require_pal)
        if error:
            raise HTTPException(status_code=503, detail=error)

    # ---- GET /api/tavus/status -----------------------------------------

    @router.get("/api/tavus/status", response_model=TavusStatusResponse)
    def tavus_status() -> TavusStatusResponse:
        """Report local configuration only, not provider connectivity/credits."""
        error = _configuration_error()
        return TavusStatusResponse(
            configured=error is None,
            has_pal=bool(settings.tavus_pal_id.strip()),
            detail=error,
        )

    # ---- POST /api/tavus/conversation ----------------------------------

    @router.post("/api/tavus/conversation", response_model=CreateConversationResponse)
    async def create_conversation(body: CreateConversationRequest) -> CreateConversationResponse:
        """Create a new Tavus CVI conversation and return its URL.

        The ``conversation_url`` is SDK transport, not a separate room UI.
        """
        _require_configuration()

        payload: dict[str, Any] = {
            "conversation_name": body.conversation_name,
            "pal_id": settings.tavus_pal_id.strip(),
            "audio_only": False,
            "conversational_context": _ASSISTANT_CONTEXT,
            "properties": {
                "languages": [body.language.lower()],
                "enable_closed_captions": True,
                "participant_left_timeout": 10,
                "participant_absent_timeout": 60,
                "max_call_duration": 1800,
            },
        }
        if settings.tavus_replica_id.strip():
            payload["face_id"] = settings.tavus_replica_id.strip()

        if body.conversational_context.strip():
            payload["conversational_context"] += "\n\nSession context:\n" + body.conversational_context.strip()

        if body.custom_greeting.strip():
            payload["custom_greeting"] = body.custom_greeting.strip()

        try:
            resp = await asyncio.to_thread(
                _post_to_tavus,
                f"{_TAVUS_BASE}/v2/conversations",
                headers=_headers(),
                json=payload,
            )
        except httpx.RequestError as exc:
            logger.error("Tavus API request failed: %s", exc)
            raise HTTPException(status_code=502, detail="Unable to reach Tavus API.") from exc

        if resp.status_code not in (200, 201):
            logger.error(
                "Tavus create conversation failed: status=%s body=%s",
                resp.status_code,
                resp.text,
            )
            # 402 → out of conversational credits; surface a clear, actionable
            # message instead of a generic 502 so the developer knows exactly what
            # to do (top up credits at https://platform.tavus.io).
            if resp.status_code == 402:
                raise HTTPException(
                    status_code=402,
                    detail=(
                        "Tavus account is out of conversational credits. "
                        "Please top up at https://platform.tavus.io to resume video avatar sessions."
                    ),
                )
            raise HTTPException(
                status_code=502,
                detail=f"Tavus API error ({resp.status_code}): {resp.text[:200]}",
            )

        try:
            data = resp.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Tavus returned an invalid response.") from exc
        if not isinstance(data, dict):
            raise HTTPException(status_code=502, detail="Tavus returned an invalid response.")
        conversation_id = data.get("conversation_id", "")
        conversation_url = data.get("conversation_url", "")

        if (
            not isinstance(conversation_id, str) or not conversation_id
            or not isinstance(conversation_url, str) or not conversation_url
        ):
            logger.error("Tavus response missing conversation identifiers")
            raise HTTPException(
                status_code=502,
                detail="Tavus did not return a conversation_id and conversation_url.",
            )
        try:
            parsed_url = urlparse(conversation_url)
            valid_url = parsed_url.scheme == "https" and bool(parsed_url.hostname)
        except ValueError:
            valid_url = False
        if not valid_url:
            raise HTTPException(status_code=502, detail="Tavus returned an invalid conversation URL.")

        logger.info(
            "Tavus conversation created: id=%s", conversation_id
        )

        return CreateConversationResponse(
            conversation_id=conversation_id,
            conversation_url=conversation_url,
            status=data.get("status", "active"),
            meeting_token=data.get("meeting_token"),
        )

    # ---- POST /api/tavus/conversation/end ------------------------------

    @router.post("/api/tavus/conversation/end")
    async def end_conversation(body: EndConversationRequest) -> dict[str, str]:
        """Cleanly terminate a Tavus conversation so the session doesn't
        consume minutes unnecessarily."""
        _require_configuration(require_pal=False)

        if not body.conversation_id.strip():
            raise HTTPException(status_code=400, detail="conversation_id is required.")
        if not all(char.isalnum() or char in "_-" for char in body.conversation_id):
            raise HTTPException(status_code=400, detail="Invalid conversation_id.")

        try:
            resp = await asyncio.to_thread(
                _post_to_tavus,
                f"{_TAVUS_BASE}/v2/conversations/{body.conversation_id}/end",
                headers=_headers(),
            )
        except httpx.RequestError as exc:
            logger.error("Tavus end-conversation request failed: %s", exc)
            raise HTTPException(status_code=502, detail="Unable to reach Tavus API.") from exc

        # An already-gone conversation is an idempotent success; other provider
        # failures must be visible so the client can retry cleanup.
        if resp.status_code not in (200, 201, 204, 404, 410):
            logger.warning(
                "Tavus end conversation non-success: status=%s body=%s",
                resp.status_code,
                resp.text,
            )
            raise HTTPException(status_code=502, detail="Tavus could not end the conversation. Please retry.")

        logger.info("Tavus conversation ended: id=%s", body.conversation_id)
        return {"status": "ended", "conversation_id": body.conversation_id}

    return router
