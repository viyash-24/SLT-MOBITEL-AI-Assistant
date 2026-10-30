"""LiveKit token route — POST /api/livekit/token."""
from __future__ import annotations

from datetime import timedelta
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from livekit import api
from pydantic import BaseModel

router = APIRouter()


class LiveKitTokenRequest(BaseModel):
    language: Literal["EN", "SI", "TA"] = "EN"


class LiveKitTokenResponse(BaseModel):
    token: str
    url: str
    room: str
    language: str


def livekit_router(settings) -> APIRouter:
    """Factory: binds LiveKit token generation to settings."""

    @router.post("/api/livekit/token", response_model=LiveKitTokenResponse)
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
        if any(
            char in livekit_api_secret or char in livekit_api_key
            for char in ("•", "●", "·", "*")
        ):
            raise HTTPException(
                status_code=500,
                detail=(
                    "LIVEKIT_API_SECRET or LIVEKIT_API_KEY contains masked "
                    "bullet/placeholder characters."
                ),
            )
        if not livekit_url.startswith(("wss://", "ws://")):
            raise HTTPException(
                status_code=503,
                detail="LIVEKIT_URL must start with wss:// (or ws:// for local dev).",
            )

        language = request.language.upper()
        room = f"{settings.livekit_room}-{language.lower()}-{uuid4().hex[:12]}"
        identity = f"customer-{uuid4().hex[:12]}"
        token = (
            api.AccessToken(livekit_api_key, livekit_api_secret)
            .with_identity(identity)
            .with_name("SLT-MOBITEL customer")
            .with_metadata(language)
            .with_ttl(timedelta(minutes=15))
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=room,
                    can_publish=True,
                    can_publish_data=True,
                    can_subscribe=True,
                )
            )
        )
        return LiveKitTokenResponse(
            token=token.to_jwt(),
            url=livekit_url,
            room=room,
            language=language,
        )

    return router
