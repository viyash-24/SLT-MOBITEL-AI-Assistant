"""Dependency injection wiring for the SLT-MOBITEL AI Assistant.

Creates and caches the AssistantService singleton by wiring together the
infrastructure adapters (adapters for LLM, vector store, repository).

This module is the composition root for the backend application — the only
place where concrete infrastructure classes are imported and assembled.
"""
from __future__ import annotations

from functools import lru_cache

from app.application.services.assistant_service import AssistantService
from app.infrastructure.llm.gemini_llm_adapter import GeminiLLMAdapter
from app.infrastructure.repositories.postgres_chat_repository import get_chat_repository
from app.infrastructure.vector_store.pgvector_adapter import PGVectorAdapter


@lru_cache(maxsize=1)
def get_assistant_service() -> AssistantService:
    """Return the process-wide AssistantService singleton.

    Dependency graph (Adapter Pattern):
      AssistantService
        ├── GeminiLLMAdapter    → chat.generate_answer() → LangChain Gemini
        ├── PGVectorAdapter     → rag.RagService._vector_store() → PGVector
        └── PostgresChatRepository → SQLAlchemy pooled engine → PostgreSQL
    """
    from config import get_settings          # noqa: PLC0415
    from rag import get_rag_service          # noqa: PLC0415

    settings = get_settings()
    rag_service = get_rag_service()

    llm = GeminiLLMAdapter(settings)
    vector_store = PGVectorAdapter(rag_service)
    repository = get_chat_repository(settings.database_url)

    return AssistantService(
        llm=llm,
        vector_store=vector_store,
        repository=repository,
    )
