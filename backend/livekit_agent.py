"""SLT-MOBITEL LiveKit Voice Agent.

Run with:
    python livekit_agent.py start
    -- or --
    python livekit_agent.py dev   (hot-reload for development)

The agent connects to a LiveKit room, creates a Gemini Live realtime session,
and uses the SLT-MOBITEL pgvector RAG knowledge base to answer customer queries.

Fixes applied:
  • Language extracted AFTER ctx.connect() so ctx.room.name is populated.
  • Language falls back to token metadata (participant.metadata set by main.py).
  • generate_reply() is NOT awaited — waiting for the greeting to finish before
    returning from voice_session() caused the session to stop listening for audio
    after the greeting completed.  Fire-and-forget is correct here; the AgentSession
    keeps running its background tasks regardless of when voice_session() returns.
  • user_away_timeout=None so the session never silently finalises while the
    customer is thinking or between questions.
  • session_resumption removed from RealtimeModel constructor — the SDK manages
    reconnect handles internally; passing an empty SessionResumptionConfig() was
    triggering unstable reconnects on slow networks.
  • conn_options with higher timeout / more retries for the Gemini Live WebSocket.
  • _vector_store() is cached per RagService instance (see rag.py) — no new
    PGVector connection on every tool call.
"""

import asyncio
import json
import logging
import os

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    APIConnectOptions,
    JobContext,
    RunContext,
    cli,
    function_tool,
)
from livekit.plugins import google
from livekit.plugins.google.realtime import RealtimeModel
from google.genai import types

from config import get_settings
from database import save_chat_exchange
from rag import get_rag_service

logger = logging.getLogger("slt_livekit_agent")
settings = get_settings()
server = AgentServer()

# BCP-47 language codes for Gemini Live (improves multilingual recognition).
_LANGUAGE_CODES: dict[str, str] = {
    "EN": "en-US",
    "SI": "si-LK",
    "TA": "ta-LK",
}

_LANGUAGE_NAMES: dict[str, str] = {
    "EN": "English",
    "SI": "Sinhala",
    "TA": "Tamil",
}


def _resolve_language(code: str) -> tuple[str, str]:
    """Return (bcp47, human_name) for a 2-letter language code."""
    key = code.upper()
    return _LANGUAGE_CODES.get(key, "en-US"), _LANGUAGE_NAMES.get(key, "English")


class SltAssistant(Agent):
    """Voice agent persona for SLT-MOBITEL customer care."""

    def __init__(self, language_name: str, session_id: str, room) -> None:
        super().__init__(
            instructions=(
                f"You are Alt, the professional SLT-MOBITEL Sri Lanka customer-care voice assistant. "
                f"Speak naturally and concisely in {language_name}. "
                f"Keep replies to one to three short spoken sentences — this is a phone call, not an essay. "
                f"Use the query_slt_knowledge tool whenever a customer asks about products, packages, "
                f"billing, roaming, or technical support. "
                f"Never invent prices, data quotas, speeds, or policies. "
                f"If verified information is unavailable, direct the customer to the SLT helpline at 1212. "
                f"After answering, politely ask whether there is anything else you can help with."
            ),
        )
        self.session_id = session_id
        self.room = room
        self.recent_sources: list[dict[str, str]] = []

    async def publish_event(self, payload: dict[str, str]) -> None:
        """Send lightweight transcript/source events without introducing a second socket."""
        try:
            await self.room.local_participant.publish_data(
                json.dumps(payload).encode("utf-8"),
                reliable=True,
                topic="slt.voice",
            )
        except Exception:
            logger.warning("Could not publish voice event", exc_info=True)

    @function_tool
    async def query_slt_knowledge(self, context: RunContext, query: str) -> str:
        """Search the official SLT-MOBITEL pgvector knowledge base for the customer's query.

        Always call this tool before answering any question about SLT products,
        packages, prices, coverage, billing, or technical support.
        """
        rag = get_rag_service()

        def _search() -> list:
            # _vector_store() is cached — no new DB connection per call.
            return rag._vector_store().similarity_search(query, k=3)

        try:
            documents = await asyncio.to_thread(_search)
        except Exception as exc:
            logger.warning("pgvector search failed (%s); falling back to keyword search.", exc)
            documents = rag._fallback_search(query, k=3)

        if not documents:
            return (
                "No verified matching information was found in the SLT-MOBITEL knowledge base. "
                "Advise the customer to call the SLT helpline at 1212."
            )

        self.recent_sources.clear()
        for document in documents:
            source_item = {
                "title": str(document.metadata.get("title", "SLT knowledge")),
                "category": str(document.metadata.get("category", "Knowledge base")),
            }
            self.recent_sources.append(source_item)
            await self.publish_event(
                {
                    "type": "source",
                    "title": source_item["title"],
                    "category": source_item["category"],
                }
            )

        return "\n\n".join(
            f"[{doc.metadata.get('title', 'SLT knowledge')}]: {doc.page_content}"
            for doc in documents
        )


@server.rtc_session()
async def voice_session(ctx: JobContext) -> None:
    """Entry point called by the LiveKit agent framework for each new room."""

    # ── Step 1: connect to the room & wait for participant ───────────────────
    # Connect first so the agent joins the room signaling channel.
    await ctx.connect()

    # Wait for the customer participant to arrive before greeting
    try:
        participant = await ctx.wait_for_participant()
    except Exception:
        participant = None

    room_name = ctx.room.name
    session_id = room_name or f"voice-{id(ctx)}"

    # Automatically disconnect agent when all remote participants leave
    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(p):
        if len(ctx.room.remote_participants) == 0:
            logger.info("All participants left room %r; closing voice session.", room_name)
            ctx.shutdown()

    # ── Step 2: determine language ────────────────────────────────────────────
    try:
        # Room name format: <prefix>-<language_code>-<8hex>
        language_code = room_name.rsplit("-", 2)[-2].upper()
        if language_code not in _LANGUAGE_CODES:
            raise ValueError(f"unknown code: {language_code!r}")
    except (IndexError, ValueError):
        language_code = (
            participant.metadata if participant and participant.metadata else "EN"
        ).upper()
        if language_code not in _LANGUAGE_CODES:
            language_code = "EN"
        logger.warning(
            "Could not parse language from room name %r; using %r.",
            room_name,
            language_code,
        )

    bcp47, language_name = _resolve_language(language_code)
    logger.info("Voice session started | room=%r lang=%s bcp47=%s", room_name, language_name, bcp47)

    # ── Step 3: build Gemini Live realtime session ────────────────────────────
    # conn_options: longer timeout + more retries for the Gemini Live WebSocket.
    # session_resumption is intentionally NOT set here — the SDK manages the
    # resumption handle internally.  Passing an empty SessionResumptionConfig()
    # interfered with reconnect logic on high-latency connections.
    realtime_model = RealtimeModel(
        model=settings.gemini_live_model,
        api_key=settings.google_api_key,
        voice="Aoede",          # Gemini Live voice; change to "Puck", "Charon", etc.
        language=bcp47,         # Improves ASR accuracy for the selected language
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        conn_options=APIConnectOptions(
            max_retry=5,
            retry_interval=2.0,
            timeout=30.0,
        ),
    )

    # user_away_timeout=None: never silently finalise the conversation because
    # the customer paused for a few seconds between questions.  Without this,
    # the default 15-second timeout would end the session right after the
    # greeting before the customer had a chance to speak.
    agent_session = AgentSession(
        llm=realtime_model,
        user_away_timeout=None,
    )
    assistant = SltAssistant(language_name, session_id, ctx.room)
    last_user_text: list[str] = [""]

    def on_agent_state_changed(event) -> None:
        asyncio.create_task(
            assistant.publish_event({"type": "state", "state": event.new_state})
        )

    def on_user_input_transcribed(event) -> None:
        if event.transcript:
            if event.is_final:
                last_user_text[0] = event.transcript
            asyncio.create_task(
                assistant.publish_event(
                    {
                        "type": "transcript",
                        "role": "user",
                        "text": event.transcript,
                        "final": str(event.is_final).lower(),
                    }
                )
            )

    def on_conversation_item_added(event) -> None:
        text = getattr(event.item, "text_content", None)
        if text and getattr(event.item, "role", None) == "assistant":
            asyncio.create_task(
                assistant.publish_event(
                    {
                        "type": "transcript",
                        "role": "assistant",
                        "text": text,
                        "final": "true",
                    }
                )
            )
            # Persist chat turn into PostgreSQL database
            if last_user_text[0]:
                u_text = last_user_text[0]
                sources_snapshot = [dict(s) for s in assistant.recent_sources]
                asyncio.create_task(
                    asyncio.to_thread(
                        save_chat_exchange,
                        settings,
                        session_id,
                        u_text,
                        text,
                        "high" if sources_snapshot else "medium",
                        sources_snapshot,
                    )
                )

    agent_session.on("agent_state_changed", on_agent_state_changed)
    agent_session.on("user_input_transcribed", on_user_input_transcribed)
    agent_session.on("conversation_item_added", on_conversation_item_added)

    # ── Step 4: start the session ─────────────────────────────────────────────
    await agent_session.start(
        room=ctx.room,
        agent=assistant,
    )

    # ── Step 5: greet the customer ─────────────────────────────────────────────
    # Fire-and-forget: do NOT await the SpeechHandle.
    # Awaiting would block voice_session() until the greeting finishes speaking,
    # which caused the framework to consider the entrypoint "done" and stop
    # routing new user audio through the active session.  The AgentSession runs
    # its background tasks independently and will continue listening for user
    # speech after this function returns.
    agent_session.generate_reply(
        instructions="Greet the customer warmly in their language and ask how you can help today.",
    )
    logger.info("Greeting queued; voice_session() returning — session stays alive via AgentSession tasks.")


if __name__ == "__main__":
    # AgentServer reads LiveKit worker credentials from process environment.
    # Settings loads backend/.env for the application, so bridge the values
    # before the CLI starts the worker.
    os.environ.setdefault("LIVEKIT_URL", settings.livekit_url)
    os.environ.setdefault("LIVEKIT_API_KEY", settings.livekit_api_key)
    os.environ.setdefault("LIVEKIT_API_SECRET", settings.livekit_api_secret)
    cli.run_app(server)