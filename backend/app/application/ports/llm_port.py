"""Application-layer port (interface) for the LLM provider.

Uses Python's typing.Protocol so the application service depends on this
abstract interface, not on LangChain or any specific vendor SDK.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class LLMPort(Protocol):
    """Generate a text answer from context, history, and user message."""

    def generate(
        self,
        context: str,
        history: str,
        message: str,
    ) -> str:
        """Return the LLM-generated answer string.

        Raises:
            app.domain.exceptions.ConfigurationError – API key not set.
            app.domain.exceptions.ProviderError      – LLM call failed.
        """
        ...
