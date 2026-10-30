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

    def search(self, query: str, k: int = 5) -> list:
        """Search the vector store; fall back to keyword search on failure.

        Always returns a list (possibly empty).  Never raises.
        """
        if self._vector_enabled:
            try:
                return self._rag._vector_store().similarity_search(query, k=k)
            except Exception as exc:
                self._vector_enabled = False
                logger.info(
                    "PGVector unavailable (%s). Switched to keyword fallback.", exc
                )

        try:
            return self._rag._fallback_search(query, k=k)
        except Exception as fallback_exc:
            logger.error("PGVectorAdapter: keyword fallback also failed: %s", fallback_exc)
            return []
