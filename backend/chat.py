"""LLM answer-generation layer for the SLT-MOBITEL AI Assistant.

Sends the RAG context, conversation history, and user question to Gemini
via LangChain's ChatGoogleGenerativeAI interface.

Fixes applied:
  • Prompt is now sent as structured SystemMessage + HumanMessage instead of a
    raw concatenated string — avoids safety-filter false positives that produced
    "model output must contain either output text or tool calls" errors.
  • Empty / blocked responses are detected and replaced with a polite fallback
    rather than propagating the SDK-level ValueError.
  • One automatic retry is attempted on an empty response before falling back.
"""

import logging
from typing import Sequence

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from config import Settings
from prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)

_FALLBACK = (
    "I'm sorry, I could not retrieve a verified answer at this moment. "
    "Please call SLT-MOBITEL customer care on 1212 for immediate assistance."
)

_MAX_RETRIES = 2


def _build_messages(context: str, history: str, message: str) -> list[BaseMessage]:
    """Return a structured chat message list for LangChain.

    Using SystemMessage + HumanMessage (rather than a single raw string) ensures
    Gemini receives the role metadata it needs and reduces safety-filter false
    positives that can produce empty content responses.
    """
    system_text = SYSTEM_PROMPT.format(context=context)
    if history:
        system_text = f"{system_text}\n\nConversation history:\n{history}"
    return [
        SystemMessage(content=system_text),
        HumanMessage(content=message),
    ]


def _extract_text(content) -> str:
    """Safely extract a string from various content shapes Gemini can return."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict):
                parts.append(part.get("text", ""))
            elif isinstance(part, str):
                parts.append(part)
            else:
                parts.append(str(part))
        return "".join(parts).strip()
    return str(content).strip()


def generate_answer(settings: Settings, context: str, history: str, message: str) -> str:
    """Invoke Gemini and return the answer text.

    Returns a polite fallback string instead of raising if Gemini returns an
    empty or safety-blocked response.
    """
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not configured")

    llm = ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        temperature=0.1,
        google_api_key=settings.google_api_key,
        # Disable automatic retries inside the SDK — we handle retries here so
        # we can apply our own empty-response detection logic.
        max_retries=1,
    )

    messages = _build_messages(context, history, message)

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = llm.invoke(messages)
            text = _extract_text(response.content)
            if text:
                return text

            # Empty response — Gemini returned nothing (safety filter or quota).
            logger.warning(
                "Gemini returned an empty response on attempt %d/%d "
                "(possible safety filter or quota issue).",
                attempt,
                _MAX_RETRIES,
            )
        except Exception as exc:
            err_str = str(exc)
            # Surface the "model output must contain either output text or tool calls"
            # error as a warning and fall through to retry / fallback.
            if "model output" in err_str or "output text" in err_str:
                logger.warning(
                    "Gemini model output error on attempt %d/%d: %s",
                    attempt,
                    _MAX_RETRIES,
                    exc,
                )
            else:
                # Unexpected error — re-raise immediately.
                raise

    logger.error(
        "Gemini returned no usable output after %d attempts. Returning fallback.",
        _MAX_RETRIES,
    )
    return _FALLBACK
