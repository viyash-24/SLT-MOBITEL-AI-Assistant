"""Application-layer port (interface) for the conversation repository.

Decouples the application service from the specific database or ORM used
to persist chat history.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class ChatRepositoryPort(Protocol):
    """Persist conversation exchanges."""

    def save_exchange(
        self,
        session_id: str,
        user_message: str,
        assistant_message: str,
        confidence: str,
        sources: list[dict[str, str]],
    ) -> bool:
        """Persist one user↔assistant exchange.

        Returns True on success, False on failure (silently — callers do not
        need to react to persistence failures).
        """
        ...
