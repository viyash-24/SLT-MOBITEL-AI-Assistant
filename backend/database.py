"""Database operations and health check.

Delegates persistence to the pooled PostgresChatRepository (Repository Pattern).
"""
from __future__ import annotations

from sqlalchemy import create_engine, text

from app.infrastructure.repositories.postgres_chat_repository import get_chat_repository
from config import Settings


def database_ready(settings: Settings) -> bool:
    if not settings.database_configured:
        return False
    try:
        engine = create_engine(settings.database_url, pool_pre_ping=True)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


def save_chat_exchange(
    settings: Settings,
    session_id: str,
    user_message: str,
    assistant_message: str,
    confidence: str,
    sources: list[dict[str, str]],
) -> bool:
    """Save exchange via the repository pattern with connection pooling."""
    if not settings.database_configured:
        return False
    repo = get_chat_repository(settings.database_url)
    return repo.save_exchange(
        session_id=session_id,
        user_message=user_message,
        assistant_message=assistant_message,
        confidence=confidence,
        sources=sources,
    )
