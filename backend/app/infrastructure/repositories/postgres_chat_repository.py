"""PostgreSQL chat repository — implements ChatRepositoryPort.

Repository Pattern: separates persistence from the application service.
Uses a module-level SQLAlchemy engine with a connection pool so we do not
create a new engine on every save (unlike the original database.py).
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache

from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool

logger = logging.getLogger(__name__)

# DDL executed once on first use
_CREATE_TABLE_SQL = text("""
    CREATE TABLE IF NOT EXISTS chat_messages (
        id          BIGSERIAL PRIMARY KEY,
        session_id  VARCHAR(120) NOT NULL,
        role        VARCHAR(20)  NOT NULL CHECK (role IN ('user', 'assistant')),
        content     TEXT         NOT NULL,
        confidence  VARCHAR(20),
        sources     TEXT         NOT NULL DEFAULT '[]',
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
""")

_INSERT_SQL = text("""
    INSERT INTO chat_messages (session_id, role, content, confidence, sources)
    VALUES (:session_id, :role, :content, :confidence, :sources)
""")


class PostgresChatRepository:
    """ChatRepositoryPort implementation backed by PostgreSQL.

    A single pooled engine is created per repository instance.
    Use `get_chat_repository()` to obtain the process-wide singleton.
    """

    def __init__(self, database_url: str) -> None:
        self._engine = create_engine(
            database_url,
            poolclass=QueuePool,
            pool_size=3,
            max_overflow=5,
            pool_pre_ping=True,
        )
        self._table_ready = False

    def _ensure_table(self) -> None:
        if self._table_ready:
            return
        try:
            with self._engine.begin() as conn:
                conn.execute(_CREATE_TABLE_SQL)
            self._table_ready = True
        except Exception as exc:
            logger.warning("Could not create chat_messages table: %s", exc)

    def save_exchange(
        self,
        session_id: str,
        user_message: str,
        assistant_message: str,
        confidence: str,
        sources: list[dict[str, str]],
    ) -> bool:
        """Persist one user↔assistant exchange.  Returns True on success."""
        self._ensure_table()
        try:
            with self._engine.begin() as conn:
                conn.execute(_INSERT_SQL, {
                    "session_id": session_id,
                    "role": "user",
                    "content": user_message,
                    "confidence": None,
                    "sources": "[]",
                })
                conn.execute(_INSERT_SQL, {
                    "session_id": session_id,
                    "role": "assistant",
                    "content": assistant_message,
                    "confidence": confidence,
                    "sources": json.dumps(sources),
                })
            return True
        except Exception as exc:
            logger.warning("Failed to persist chat exchange: %s", exc)
            return False


class _NoOpChatRepository:
    """Fallback repository used when no DATABASE_URL is configured."""

    def save_exchange(self, *args, **kwargs) -> bool:  # noqa: ANN002,ANN003
        return False


@lru_cache(maxsize=1)
def get_chat_repository(database_url: str = ""):
    """Return the process-wide ChatRepository singleton."""
    if not database_url.strip():
        logger.info("DATABASE_URL not set — chat history will not be persisted.")
        return _NoOpChatRepository()
    return PostgresChatRepository(database_url)
