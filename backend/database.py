import json

from sqlalchemy import create_engine, text

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
    if not settings.database_configured:
        return False

    try:
        engine = create_engine(settings.database_url, pool_pre_ping=True)
        with engine.begin() as connection:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id BIGSERIAL PRIMARY KEY,
                    session_id VARCHAR(120) NOT NULL,
                    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    confidence VARCHAR(20),
                    sources TEXT NOT NULL DEFAULT '[]',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """))
            insert_message = text("""
                INSERT INTO chat_messages
                    (session_id, role, content, confidence, sources)
                VALUES
                    (:session_id, :role, :content, :confidence, :sources)
            """)
            connection.execute(insert_message, {
                "session_id": session_id,
                "role": "user",
                "content": user_message,
                "confidence": None,
                "sources": "[]",
            })
            connection.execute(insert_message, {
                "session_id": session_id,
                "role": "assistant",
                "content": assistant_message,
                "confidence": confidence,
                "sources": json.dumps(sources),
            })
        engine.dispose()
        return True
    except Exception:
        return False
