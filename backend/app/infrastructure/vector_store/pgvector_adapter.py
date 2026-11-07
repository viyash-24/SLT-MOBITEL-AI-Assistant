"""PGVector adapter — implements VectorStorePort using the existing rag.py logic.

Adapter Pattern: wraps PGVector + keyword fallback behind VectorStorePort so
the application service never imports langchain_postgres directly.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class PGVectorAdapter:
    """VectorStorePort implementation backed by langchain_postgres.PGVector.

    Uses the existing RagService's cached _vector_store() and _fallback_search()
    so we do not duplicate connection management. Automatically latches to
    keyword fallback if the vector extension is not installed.
    """

    def __init__(self, rag_service) -> None:
        # Accepts the existing RagService instance — avoids rebuilding the
        # cached PGVector connection.
        self._rag = rag_service
        self._vector_enabled = True
        self._search_cache: dict[tuple[str, int], list] = {}

    def search(self, query: str, k: int = 5) -> list:
        """Search the vector store; fall back to keyword search on failure.

        Always returns a list (possibly empty).  Never raises.
        """
        cache_key = (query.strip().lower(), k)
        cached = self._search_cache.get(cache_key)
        if cached is not None:
            return cached

        documents: list = []
        used_vector = False
        if self._vector_enabled:
            try:
                documents = self._rag._vector_store().similarity_search(query, k=k)
                used_vector = True
            except Exception as exc:
                self._vector_enabled = False
                logger.info(
                    "PGVector unavailable (%s). Switched to keyword fallback.", exc
                )

        if not used_vector:
            try:
                documents = self._rag._fallback_search(query, k=k)
            except Exception as fallback_exc:
                logger.error("PGVectorAdapter: keyword fallback also failed: %s", fallback_exc)
                documents = []

        if len(self._search_cache) >= 64:
            self._search_cache.pop(next(iter(self._search_cache)))
        self._search_cache[cache_key] = documents
        return documents
