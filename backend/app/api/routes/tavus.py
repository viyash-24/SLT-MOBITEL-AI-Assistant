"""Tavus CVI (Conversational Video Interface) routes.

Provides two thin proxy endpoints that keep the TAVUS_API_KEY safely on the
server so it is never exposed to the browser:

  POST  /api/tavus/conversation       — create a new Tavus conversation session
  POST  /api/tavus/conversation/end   — end / delete an active session
  GET   /api/tavus/status             — returns whether Tavus is configured

The browser only receives the opaque `conversation_url` returned by Tavus,
which it embeds in an iframe for the full-duplex WebRTC video call.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import Settings

logger = logging.getLogger(__name__)

_TAVUS_BASE = "https://tavusapi.com"


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class CreateConversationRequest(BaseModel):
    """Optional body fields the frontend can pass when starting a session."""

    conversational_context: str = ""
    custom_greeting: str = ""
    conversation_name: str = "SLT-MOBITEL AI Voice Session"


class CreateConversationResponse(BaseModel):
    conversation_id: str
    conversation_url: str
    status: str


class EndConversationRequest(BaseModel):
    conversation_id: str


class TavusStatusResponse(BaseModel):
    configured: bool
    has_pal: bool


# ---------------------------------------------------------------------------
# Route factory (mirrors the pattern used by the other route modules)
# ---------------------------------------------------------------------------


def tavus_router(settings: Settings) -> APIRouter:
    """Return an APIRouter bound to *settings*.

    If ``TAVUS_API_KEY`` is empty the endpoints still respond, but with
    HTTP 503 so the frontend can degrade gracefully to the canvas fallback.
    """
    router = APIRouter()

    def _headers() -> dict[str, str]:
        return {
            "x-api-key": settings.tavus_api_key,
            "Content-Type": "application/json",
        }

    def _require_key() -> None:
        if not settings.tavus_api_key.strip():
            raise HTTPException(
                status_code=503,
                detail="Tavus API key is not configured. Set TAVUS_API_KEY in backend/.env.",
            )

    # ---- GET /api/tavus/status -----------------------------------------

    @router.get("/api/tavus/status", response_model=TavusStatusResponse)
    def tavus_status() -> TavusStatusResponse:
        """Return Tavus configuration health so the frontend can decide
        whether to show the live avatar or the canvas fallback."""
        return TavusStatusResponse(
            configured=bool(settings.tavus_api_key.strip()),
            has_pal=bool(settings.tavus_pal_id.strip()),
        )

    # ---- POST /api/tavus/conversation ----------------------------------

    @router.post("/api/tavus/conversation", response_model=CreateConversationResponse)
    async def create_conversation(body: CreateConversationRequest) -> CreateConversationResponse:
        """Create a new Tavus CVI conversation and return its URL.

        The ``conversation_url`` is a Daily.co-backed WebRTC room that the
        browser embeds in an iframe for real-time video + lip-sync.
        """
        _require_key()

        pal_id = settings.tavus_pal_id.strip() or "p2fbd605"
        replica_id = settings.tavus_replica_id.strip() or "r9d30b0e55ac"

        payload: dict[str, Any] = {
            "conversation_name": body.conversation_name,
            "persona_id": pal_id,
            "replica_id": replica_id,
        }

        if body.conversational_context.strip():
            payload["conversational_context"] = body.conversational_context.strip()

        if body.custom_greeting.strip():
            payload["custom_greeting"] = body.custom_greeting.strip()

        import asyncio

        def _do_post_conversation():
            with httpx.Client(timeout=30.0) as client:
                return client.post(
                    f"{_TAVUS_BASE}/v2/conversations",
                    headers=_headers(),
                    json=payload,
                )

        try:
            resp = await asyncio.to_thread(_do_post_conversation)
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
            # message instead of a generic 502 so the frontend can degrade
            # gracefully (canvas fallback) and the developer knows exactly what
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

        data = resp.json()
        conversation_id = data.get("conversation_id", "")
        conversation_url = data.get("conversation_url", "")

        if not conversation_url:
            logger.error("Tavus response missing conversation_url: %s", data)
            raise HTTPException(
                status_code=502,
                detail="Tavus did not return a conversation_url.",
            )

        logger.info(
            "Tavus conversation created: id=%s url=%s", conversation_id, conversation_url
        )

        return CreateConversationResponse(
            conversation_id=conversation_id,
            conversation_url=conversation_url,
            status=data.get("status", "active"),
        )

    # ---- POST /api/tavus/conversation/end ------------------------------

    @router.post("/api/tavus/conversation/end")
    async def end_conversation(body: EndConversationRequest) -> dict[str, str]:
        """Cleanly terminate a Tavus conversation so the session doesn't
        consume minutes unnecessarily."""
        _require_key()

        if not body.conversation_id.strip():
            raise HTTPException(status_code=400, detail="conversation_id is required.")

        def _do_end_conversation():
            with httpx.Client(timeout=30.0) as client:
                return client.post(
                    f"{_TAVUS_BASE}/v2/conversations/{body.conversation_id}/end",
                    headers=_headers(),
                )

        try:
            resp = await asyncio.to_thread(_do_end_conversation)
        except httpx.RequestError as exc:
            logger.error("Tavus end-conversation request failed: %s", exc)
            raise HTTPException(status_code=502, detail="Unable to reach Tavus API.") from exc

        # 200 / 204 → success; anything else we log but don't blow up the UI
        if resp.status_code not in (200, 201, 204):
            logger.warning(
                "Tavus end conversation non-success: status=%s body=%s",
                resp.status_code,
                resp.text,
            )

        logger.info("Tavus conversation ended: id=%s", body.conversation_id)
        return {"status": "ended", "conversation_id": body.conversation_id}

    return router
