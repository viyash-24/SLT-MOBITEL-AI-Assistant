from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    google_api_key: str = ""
    database_url: str = ""
    cors_origins: str = "http://localhost:3000"
    gemini_model: str = "gemini-2.5-flash"
    gemini_embedding_model: str = "models/gemini-embedding-001"
    pgvector_collection: str = "slt_mobitel_knowledge"
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    livekit_url: str = ""
    livekit_room: str = "slt-mobitel-voice"
    gemini_live_model: str = "gemini-2.5-flash-native-audio-preview-12-2025"

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def database_configured(self) -> bool:
        return bool(self.database_url.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
