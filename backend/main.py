"""SLT-MOBITEL AI Assistant — FastAPI application entry point.

Re-exports the Clean Architecture application from `app.main`.
This ensures backward compatibility for commands like:
    uvicorn main:app --reload
"""
from app.main import app

__all__ = ["app"]
