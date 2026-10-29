"""SLT-MOBITEL LiveKit Voice Agent — with Tavus Avatar.

Run with:
    python livekit_agent.py start
    -- or --
    python livekit_agent.py dev   (hot-reload for development)

Architecture:
    1. AgentSession connects to the LiveKit room and starts listening.
    2. AvatarSession (Tavus) starts concurrently — it creates a Tavus
       conversation via the Tavus REST API, which causes a Tavus agent
       participant to join the room and publish synchronized video+audio.
    3. The agent's audio output tail is replaced with DataStreamAudioOutput
       so all TTS audio is routed through Tavus (not published directly).
    4. The customer's browser subscribes to the Tavus participant's tracks
       and renders the video in a <video> element.

Latency trace points logged at INFO level:
    [TIMING] speech_end          — user VAD endpoint detected
    [TIMING] transcript_final    — final ASR text available
    [TIMING] rag_start           — RAG retrieval begins
    [TIMING] rag_done            — RAG retrieval complete
    [TIMING] first_token         — Gemini Live first audio chunk produced
    [TIMING] state_speaking      — agent state changed to speaking
    [TIMING] tavus_start         — AvatarSession.start() called
    [TIMING] tavus_ready         — Tavus participant joined the room
"""

import asyncio
import json
import logging
import os
import sys
import time

# ── Windows: force ProactorEventLoop ─────────────────────────────────────────
# Python's default SelectorEventLoop on Windows does not support the I/O
# primitives that LiveKit's signal-stream (WebSocket) relies on.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

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
from livekit.plugins.tavus import AvatarSession, TavusException
from google.genai import types

from app.dependencies import get_assistant_service
from config import get_settings
from database import save_chat_exchange

logger = logging.getLogger("slt_livekit_agent")
settings = get_settings()

# ── Ensure environment variables are set before AgentServer or plugins initialize
if settings.livekit_url:
    os.environ.setdefault("LIVEKIT_URL", settings.livekit_url)
if settings.livekit_api_key:
    os.environ.setdefault("LIVEKIT_API_KEY", settings.livekit_api_key)
if settings.livekit_api_secret:
    os.environ.setdefault("LIVEKIT_API_SECRET", settings.livekit_api_secret)
if settings.google_api_key:
    os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)
if settings.tavus_api_key:
    os.environ.setdefault("TAVUS_API_KEY", settings.tavus_api_key)
if settings.tavus_face_id:
    os.environ.setdefault("TAVUS_FACE_ID", settings.tavus_face_id)
if settings.tavus_pal_id:
    os.environ.setdefault("TAVUS_PAL_ID", settings.tavus_pal_id)

server = AgentServer(
    ws_url=settings.livekit_url,
    api_key=settings.livekit_api_key,
    api_secret=settings.livekit_api_secret,
)

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


def _timing(label: str, t0: float | None = None) -> float:
    """Log a latency trace point. Returns current monotonic time."""
    now = time.monotonic()
    elapsed = f" (+{(now - t0)*1000:.0f} ms)" if t0 is not None else ""
    logger.info("[TIMING] %s%s", label, elapsed)
    return now


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
        self._session_t0 = _timing("session_start")

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

        Uses the shared AssistantService (Strategy Pattern) — same retrieval
        path as the text chatbot, so both channels use identical knowledge.
        """
        t0 = _timing("rag_start")

        # ── Shared AssistantService (voice channel strategy) ──────────────────
        # Single retrieval pass returns both grounded context and source metadata.
        assistant = get_assistant_service()

        context_text, sources = await asyncio.to_thread(
            assistant.retrieve_context, query, 3
        )
        _timing("rag_done", t0)

        # Publish source metadata to the frontend for display
        try:
            self.recent_sources.clear()
            for source in sources:
                source_item = {
                    "title": source.title,
                    "category": source.category,
                }
                self.recent_sources.append(source_item)
                await self.publish_event(
                    {
                        "type": "source",
                        "title": source.title,
                        "category": source.category,
                    }
                )
        except Exception as exc:
            logger.debug("Could not publish source sidebar metadata: %s", exc)

        return context_text


@server.rtc_session()
async def voice_session(ctx: JobContext) -> None:
    """Entry point called by the LiveKit agent framework for each new room."""

    session_t0 = _timing("session_init")

    # ── Step 1: connect to the room & wait for participant ───────────────────
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
    logger.info(
        "Voice session started | room=%r lang=%s bcp47=%s", room_name, language_name, bcp47
    )

    # ── Step 3: build Gemini Live realtime session ────────────────────────────
    realtime_model = RealtimeModel(
        model=settings.gemini_live_model,
        api_key=settings.google_api_key,
        voice="Aoede",          # Gemini Live voice; change to "Puck", "Charon", etc.
        language=bcp47,         # Improves ASR accuracy for the selected language
        temperature=0.35,
        max_output_tokens=128,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        # End the user's turn shortly after a real pause. The Gemini default is
        # conservative and makes every response feel delayed in a phone call.
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                prefix_padding_ms=120,
                silence_duration_ms=400,
            ),
        ),
        conn_options=APIConnectOptions(
            max_retry=3,
            retry_interval=1.0,
            timeout=30.0,
        ),
    )

    agent_session = AgentSession(
        llm=realtime_model,
        max_tool_steps=1,
        preemptive_generation=True,
        user_away_timeout=None,
        min_endpointing_delay=0.1,
        max_endpointing_delay=0.5,
    )
    assistant = SltAssistant(language_name, session_id, ctx.room)
    last_user_text: list[str] = [""]

    # ── Latency tracking state ────────────────────────────────────────────────
    speech_end_time: list[float] = [0.0]

    def on_agent_state_changed(event) -> None:
        state = event.new_state
        if state == "speaking":
            _timing("state_speaking", speech_end_time[0] if speech_end_time[0] else None)
        asyncio.create_task(
            assistant.publish_event({"type": "state", "state": state})
        )

    def on_user_input_transcribed(event) -> None:
        if event.transcript:
            if event.is_final:
                last_user_text[0] = event.transcript
                speech_end_time[0] = _timing("transcript_final")
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

    def on_error(event) -> None:
        """Log recoverable Gemini Live / LiveKit stream errors without crashing."""
        recoverable = getattr(event, "recoverable", True)
        err = getattr(event, "error", event)
        if recoverable:
            logger.warning(
                "Recoverable voice stream error (will retry automatically): %s", err
            )
        else:
            logger.error(
                "Non-recoverable voice stream error; session will terminate: %s", err
            )

    agent_session.on("agent_state_changed", on_agent_state_changed)
    agent_session.on("user_input_transcribed", on_user_input_transcribed)
    agent_session.on("conversation_item_added", on_conversation_item_added)
    agent_session.on("error", on_error)

    # ── Step 4: start the AgentSession ────────────────────────────────────────
    await agent_session.start(
        room=ctx.room,
        agent=assistant,
    )

    # ── Step 5: start Tavus AvatarSession concurrently ───────────────────────
    # AvatarSession.start() calls the Tavus REST API to create a conversation,
    # which causes Tavus to join the room as a participant and publish video+audio.
    # It also replaces the agent's audio output tail with DataStreamAudioOutput
    # so TTS audio is routed through Tavus (synchronized lip movement).
    #
    # This runs concurrently so the agent session (and greeting) can start
    # immediately; the avatar video appears a few seconds later as Tavus connects.
    tavus_enabled = bool(os.environ.get("TAVUS_API_KEY"))

    if tavus_enabled:
        async def _start_tavus() -> None:
            tavus_t0 = _timing("tavus_start")
            try:
                avatar = AvatarSession(
                    # face_id and pal_id read from TAVUS_FACE_ID / TAVUS_PAL_ID
                    # env vars automatically when not passed explicitly.
                    # If neither is set, the Tavus plugin uses its stock defaults
                    # (face: "Lucy – Home", pal: pb87e71797da).
                    face_id=settings.tavus_face_id or None,
                    pal_id=settings.tavus_pal_id or None,
                )
                await avatar.start(agent_session, ctx.room)
                _timing("tavus_ready", tavus_t0)
                logger.info(
                    "Tavus avatar session started | conversation_id=%s",
                    avatar.conversation_id,
                )

                # Publish event so the frontend knows the avatar is live
                await assistant.publish_event(
                    {
                        "type": "avatar",
                        "status": "connected",
                        "identity": avatar.avatar_identity,
                        "conversation_id": avatar.conversation_id or "",
                    }
                )
            except TavusException as exc:
                logger.error("Tavus avatar could not start: %s", exc)
                await assistant.publish_event(
                    {"type": "avatar", "status": "unavailable", "reason": str(exc)}
                )
            except Exception as exc:
                logger.error("Unexpected Tavus error: %s", exc, exc_info=True)
                await assistant.publish_event(
                    {"type": "avatar", "status": "unavailable", "reason": str(exc)}
                )

        asyncio.create_task(_start_tavus())
    else:
        logger.warning(
            "TAVUS_API_KEY not set — running without avatar video. "
            "Voice audio will be published directly to the LiveKit room."
        )
        await assistant.publish_event({"type": "avatar", "status": "disabled"})

    # ── Step 6: greet the customer ─────────────────────────────────────────────
    # Wait in a background task for the Gemini Live WebSocket session to become
    # fully active before generating the reply, preventing timeout errors.
    async def _send_greeting() -> None:
        for _ in range(40):
            try:
                activity = getattr(agent_session, "_activity", None)
                rt = getattr(activity, "_rt_session", None) if activity else None
                if rt and getattr(rt, "_active_session", None) is not None:
                    break
            except Exception:
                pass
            await asyncio.sleep(0.5)

        try:
            agent_session.generate_reply(
                instructions=f"Greet the customer warmly in {language_name} and ask how you can help today.",
            )
            logger.info("Greeting queued successfully in %s", language_name)
        except Exception as exc:
            logger.warning("Greeting generation note: %s", exc)

    asyncio.create_task(_send_greeting())
    logger.info(
        "Greeting scheduled; voice_session() ready — session stays alive via AgentSession."
    )


if __name__ == "__main__":
    os.environ.setdefault("LIVEKIT_URL", settings.livekit_url)
    os.environ.setdefault("LIVEKIT_API_KEY", settings.livekit_api_key)
    os.environ.setdefault("LIVEKIT_API_SECRET", settings.livekit_api_secret)
    cli.run_app(server)