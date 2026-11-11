"""Simli Avatar session-token endpoint.

Keeps the Simli API key server-side only.
The frontend fetches a short-lived session token from here and passes it
directly to SimliClient — the raw API key is never sent to the browser.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from config import get_settings

SIMLI_TOKEN_URL = "https://api.simli.ai/compose/token"

# Max idle seconds before Simli reclaims the session
_MAX_IDLE = 120
# Max session length in seconds (10 min)
_MAX_SESSION = 600


def simli_router() -> APIRouter:
    router = APIRouter(prefix="/api/simli", tags=["simli"])

    @router.post("/session-token")
    async def get_session_token() -> JSONResponse:
        """Create a Simli session token and return it to the frontend.

        Calls the Simli REST API server-side so the API key is never
        exposed in browser network traffic.
        """
        settings = get_settings()
        api_key = settings.simli_api_key
        face_id = settings.simli_face_id

        if not api_key:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Simli API key not configured. "
                    "Add SIMLI_API_KEY to backend/.env and restart the server."
                ),
            )

        payload = {
            "faceId": face_id,
            "maxSessionLength": _MAX_SESSION,
            "maxIdleTime": _MAX_IDLE,
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    SIMLI_TOKEN_URL,
                    json=payload,
                    headers={
                        "x-simli-api-key": api_key,
                        "Content-Type": "application/json",
                    },
                )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"Simli API error: {resp.text[:300]}",
                )
            data = resp.json()
            # Simli returns { session_token: "..." } or { sessionToken: "..." }
            token = data.get("session_token") or data.get("sessionToken") or data.get("token")
            if not token:
                raise HTTPException(
                    status_code=502,
                    detail=f"Unexpected Simli response: {str(data)[:300]}",
                )
            return JSONResponse({"session_token": token, "face_id": face_id})

        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Simli API request timed out.")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Simli session error: {exc}") from exc

    return router
