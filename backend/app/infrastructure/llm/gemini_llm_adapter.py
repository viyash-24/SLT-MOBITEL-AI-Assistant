"""Gemini LLM adapter — implements LLMPort using the existing chat.py logic.

Adapter Pattern: wraps `chat.generate_answer()` behind LLMPort so the
application layer never imports LangChain or Google SDK directly.
"""
from __future__ import annotations

import logging

from app.domain.exceptions.assistant_exceptions import ConfigurationError, ProviderError

logger = logging.getLogger(__name__)


class GeminiLLMAdapter:
    """LLMPort implementation backed by LangChain ChatGoogleGenerativeAI.

    Delegates to the existing `generate_answer()` function so that all the
    retry / safety-filter / empty-response handling stays in one place.
    """

    def __init__(self, settings) -> None:
        # Lazy import keeps the domain/application layers import-free of LangChain.
        from config import Settings  # noqa: PLC0415
        self._settings: Settings = settings

    def generate(self, context: str, history: str, message: str) -> str:
        """Generate an answer and return it as a plain string.

        Raises:
            ConfigurationError – GOOGLE_API_KEY not set.
            ProviderError      – LLM call failed after retries.
        """
        if not self._settings.google_api_key:
            raise ConfigurationError("GOOGLE_API_KEY is not configured.")
        try:
            from chat import generate_answer  # noqa: PLC0415
            return generate_answer(self._settings, context, history, message)
        except ConfigurationError:
            raise
        except RuntimeError as exc:
            raise ConfigurationError(str(exc)) from exc
        except Exception as exc:
            logger.error("GeminiLLMAdapter: generation failed: %s", exc, exc_info=True)
            raise ProviderError(f"LLM generation failed: {exc}") from exc
