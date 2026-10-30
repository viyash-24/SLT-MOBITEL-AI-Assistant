"""Application-layer port (interface) for the vector store.

Separates the application service from pgvector / LangChain specifics.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class RetrievedDocument(Protocol):
    """Minimal interface for a retrieved knowledge-base document."""
    page_content: str
    metadata: dict


@runtime_checkable
class VectorStorePort(Protocol):
    """Retrieve relevant knowledge-base documents for a query."""

    def search(self, query: str, k: int = 5) -> list:
        """Return up to *k* documents most relevant to *query*.

        Must not raise — return an empty list on failure.
        The returned objects must have .page_content (str) and .metadata (dict).
        """
        ...
