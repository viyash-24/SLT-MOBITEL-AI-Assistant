"""LLM answer-generation layer for the SLT-MOBITEL AI Assistant.

Sends the RAG context, conversation history, and user question to Gemini
via LangChain's ChatGoogleGenerativeAI interface.
Supports both "text" and "voice" channel strategies with automatic
model fallback and quota exhaustion recovery.
"""

import logging
from typing import Sequence

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from config import Settings
from prompt import SYSTEM_PROMPT, VOICE_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

_FALLBACK = (
    "I'm sorry, I could not retrieve a verified answer at this moment. "
    "Please call SLT-MOBITEL customer care on 1212 for immediate assistance."
)

_MAX_RETRIES = 2

# Models to attempt in order if the primary model hits a 429 quota exhaustion limit
_CANDIDATE_FALLBACK_MODELS = (
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
)


def _is_quota_or_rate_limit_error(exc: Exception) -> bool:
    """Check if an exception is caused by a 429 quota exhaustion or rate limit."""
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    return (
        "resourceexhausted" in name
        or "429" in msg
        or "quota" in msg
        or "rate limit" in msg
        or "ratelimit" in name
    )


def _build_messages(context: str, history: str, message: str, channel: str = "text") -> list[BaseMessage]:
    """Return a structured chat message list for LangChain."""
    template = VOICE_SYSTEM_PROMPT if channel == "voice" else SYSTEM_PROMPT
    system_text = template.format(context=context)
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


def generate_answer(settings: Settings, context: str, history: str, message: str, channel: str = "text") -> str:
    """Invoke Gemini and return the answer text.

    If the primary model is rate-limited or exhausts its free-tier quota (429 ResourceExhausted),
    this function automatically falls back to alternative lightweight models.
    """
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not configured")

    messages = _build_messages(context, history, message, channel=channel)
    temperature = 0.2 if channel == "voice" else 0.1

    # Build ordered list of candidate models without duplicates
    models_to_try: list[str] = [settings.gemini_model]
    for fallback_model in _CANDIDATE_FALLBACK_MODELS:
        if fallback_model not in models_to_try:
            models_to_try.append(fallback_model)

    last_error: Exception | None = None

    for model_name in models_to_try:
        try:
            llm = ChatGoogleGenerativeAI(
                model=model_name,
                temperature=temperature,
                google_api_key=settings.google_api_key,
                max_retries=1,
            )

            for attempt in range(1, _MAX_RETRIES + 1):
                try:
                    response = llm.invoke(messages)
                    text = _extract_text(response.content)
                    if text:
                        return text

                    logger.warning(
                        "Gemini model '%s' returned an empty response on attempt %d/%d.",
                        model_name,
                        attempt,
                        _MAX_RETRIES,
                    )
                except Exception as exc:
                    last_error = exc
                    if _is_quota_or_rate_limit_error(exc):
                        logger.warning(
                            "Gemini model '%s' quota exceeded or rate-limited (%s). Switching to fallback model...",
                            model_name,
                            exc,
                        )
                        break  # Break out of attempts loop to try the next model

                    err_str = str(exc)
                    if "model output" in err_str or "output text" in err_str:
                        logger.warning(
                            "Gemini model '%s' output error on attempt %d/%d: %s",
                            model_name,
                            attempt,
                            _MAX_RETRIES,
                            exc,
                        )
                    else:
                        raise

        except Exception as exc:
            last_error = exc
            if _is_quota_or_rate_limit_error(exc):
                logger.warning(
                    "Gemini model '%s' quota exhausted (%s). Trying next available model...",
                    model_name,
                    exc,
                )
                continue
            raise

    # If all models hit quota or failed
    if last_error and _is_quota_or_rate_limit_error(last_error):
        logger.error(
            "All Gemini candidate models exceeded quota or rate limits. Returning customer helpline fallback answer: %s",
            last_error,
        )
        return _FALLBACK

    logger.error(
        "Gemini returned no usable output after trying models %s. Returning fallback.",
        models_to_try,
    )
    return _FALLBACK
