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
