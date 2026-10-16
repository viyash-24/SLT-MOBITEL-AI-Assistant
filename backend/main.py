"""SLT-MOBITEL AI Assistant — FastAPI application entry point.

Re-exports the Clean Architecture application from `app.main`.
This ensures backward compatibility for commands like:
    uvicorn main:app --reload
"""
from app.main import app
from app.api.routes.livekit import LiveKitTokenRequest, LiveKitTokenResponse

__all__ = ["app", "LiveKitTokenRequest", "LiveKitTokenResponse"]
