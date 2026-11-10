from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any
from uuid import uuid4

import websockets.exceptions
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.application.services.assistant_service import AssistantService
from config import Settings

logger = logging.getLogger(__name__)

router = APIRouter()

_LIVE_MODEL = "gemini-2.5-flash-native-audio-latest"
_VOICE_CONTEXT_CHARS = 450   # Super concise context for instant voice synthesis

# Resilient VAD settings:
# Use LOW start sensitivity, 1000ms silence duration, and 200ms prefix padding
# to prevent false barge-in, eliminate stuttering/breaks, and allow natural pauses in customer speech.
_OPTIMISED_VAD = types.AutomaticActivityDetection(
    start_of_speech_sensitivity="START_SENSITIVITY_LOW",
    end_of_speech_sensitivity="END_SENSITIVITY_LOW",
    silence_duration_ms=1000,
    prefix_padding_ms=200,
)

_REALTIME_INPUT_CONFIG = types.RealtimeInputConfig(
    automatic_activity_detection=_OPTIMISED_VAD,
    activity_handling="START_OF_ACTIVITY_INTERRUPTS",
    turn_coverage="TURN_INCLUDES_ONLY_ACTIVITY",
)

_CONTEXT_COMPRESSION = types.ContextWindowCompressionConfig(
    trigger_tokens=8000,
    sliding_window=types.SlidingWindow(target_tokens=6000),
)
_LIVE_CONNECT_TIMEOUT = 30.0

_cached_client: genai.Client | None = None
_cached_api_key: str | None = None


def _get_genai_client(api_key: str) -> genai.Client:
    global _cached_client, _cached_api_key
    if _cached_client is None or _cached_api_key != api_key:
        _cached_client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                async_client_args={"ping_interval": None, "ping_timeout": None}
            ),
        )
        if hasattr(_cached_client, "_api_client") and hasattr(
            _cached_client._api_client, "_websocket_ssl_ctx"
        ):
            _cached_client._api_client._websocket_ssl_ctx["open_timeout"] = 30
        _cached_api_key = api_key
    return _cached_client


def _language_profile(language: str) -> tuple[str, str, str]:
    """Return (prompt_code, bcp47, greeting_kind) from the client language flag."""
    lang_upper = (language or "EN").upper()
    if "SI" in lang_upper or "SINHALA" in lang_upper:
        return "SI", "si-LK", "si"
    if "TA" in lang_upper or "TAMIL" in lang_upper:
        return "TA", "ta-IN", "ta"
    return "EN", "en-US", "en"


def _merge_transcript(accumulated: str, incoming: str) -> str:
    """Merge a Gemini transcription fragment into the turn accumulator."""
    incoming = (incoming or "").replace("\x00", "")
    if not incoming:
        return accumulated
    if not accumulated:
        return incoming

    accumulated_clean = accumulated.strip()
    incoming_clean = incoming.strip()

    if incoming_clean == accumulated_clean or incoming_clean in accumulated_clean:
        return accumulated
    if incoming_clean.startswith(accumulated_clean):
        return incoming
    if accumulated_clean.startswith(incoming_clean):
        return accumulated

    overlap_limit = min(len(accumulated), len(incoming), 80)
    for size in range(overlap_limit, 0, -1):
        if accumulated.endswith(incoming[:size]):
            return accumulated + incoming[size:]

    if incoming[:1] in ".,!?:;":
        return accumulated.rstrip() + incoming

    if accumulated.endswith(" ") or incoming.startswith(" "):
        return accumulated + incoming

    return accumulated + " " + incoming


def _trim_voice_context(text: str, limit: int = _VOICE_CONTEXT_CHARS) -> str:
    if len(text) <= limit:
        return text
    clipped = text[:limit]
    if "\n" in clipped:
        clipped = clipped.rsplit("\n", 1)[0]
    return clipped + "\n[Additional matching knowledge truncated for voice latency.]"


def _get_system_prompt(language: str) -> str:
    _, _, kind = _language_profile(language)
    if kind == "si":
        lang_note = (
            "Respond warmly, naturally, and clearly in Sinhala (සිංහල). "
            "Speak at a calm, steady, well-paced conversational speed. "
            "Keep responses conversational, natural, and clear (1 to 2 short sentences maximum)."
        )
    elif kind == "ta":
        lang_note = (
            "Respond warmly, naturally, and clearly in Tamil (தமிழ்). "
            "Speak at a calm, steady, well-paced conversational speed. "
            "Keep responses conversational, natural, and clear (1 to 2 short sentences maximum)."
        )
    else:
        lang_note = (
            "Respond warmly, naturally, and clearly in English. "
            "Speak at a calm, steady, well-paced conversational speed. "
            "Keep responses conversational, natural, and clear (1 to 2 short sentences maximum)."
        )

    return (
        "You are the virtual AI customer-care voice assistant for SLT-MOBITEL, "
        "Sri Lanka's premier telecommunications network. "
        "When introducing yourself, say you are SLT Avatar, the SLT-MOBITEL AI Assistant. Do not use a personal name. "
        "You are in a live phone-call style conversation with a customer. "
        f"{lang_note} "
        "IMPORTANT RULES:\n"
        "1. Never speak markdown, bullet points, asterisks, URLs, or tables.\n"
        "2. Speak in a clear, natural, warmly paced, and steady voice. Do not rush or speak too fast.\n"
        "3. Keep spoken responses conversational, friendly, and informative (1 to 2 short sentences maximum).\n"
        "4. Always call the `query_slt_knowledge` tool whenever the customer asks about packages "
        "(Fiber/FTTH, 4G LTE, ADSL), new connection charges, prices, router settings, or bill payments.\n"
        "5. Base your answers strictly on verified information returned by `query_slt_knowledge`.\n"
        "6. When answering about packages, mention the key package names (such as Fiber Starter, "
        "Trio Vibe, or Unlimited packages) and their key monthly rentals or speeds from the verified knowledge.\n"
        "7. Only suggest calling the SLT customer helpline on 1212 if the requested specific information "
        "is not found in the verified knowledge base."
    )


def _build_rag_tool() -> types.Tool:
    return types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="query_slt_knowledge",
                description=(
                    "Retrieve official SLT-MOBITEL verified knowledge on broadband packages, "
                    "fiber connection charges, data limits, router configurations, and customer support."
                ),
                parameters=types.Schema(
                    type="OBJECT",
                    properties={
                        "query": types.Schema(
                            type="STRING",
                            description="Keywords or question to search in SLT-MOBITEL knowledge.",
                        )
                    },
                    required=["query"],
                ),
            )
        ]
    )


def _transcription_config(bcp47: str | None) -> types.AudioTranscriptionConfig:
    if bcp47:
        return types.AudioTranscriptionConfig(language_codes=[bcp47])
    return types.AudioTranscriptionConfig()


def _build_live_config(
    language: str,
    *,
    with_language_hint: bool = True,
    with_zero_thinking: bool = True,
) -> types.LiveConnectConfig:
    _, bcp47, _ = _language_profile(language)
    hint = bcp47 if with_language_hint else None
    speech_kwargs: dict[str, Any] = {
        "voice_config": types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
        )
    }
    if hint and hint.startswith("en"):
        speech_kwargs["language_code"] = hint

    config_kwargs: dict[str, Any] = {
        "response_modalities": ["AUDIO"],
        "speech_config": types.SpeechConfig(**speech_kwargs),
        "tools": [_build_rag_tool()],
        "system_instruction": types.Content(
            parts=[types.Part.from_text(text=_get_system_prompt(language))]
        ),
        "input_audio_transcription": _transcription_config(hint),
        "output_audio_transcription": _transcription_config(hint),
        "realtime_input_config": _REALTIME_INPUT_CONFIG,
        "context_window_compression": _CONTEXT_COMPRESSION,
        "temperature": 0.4,
    }
    if with_zero_thinking:
        config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)

    return types.LiveConnectConfig(**config_kwargs)


async def _safe_send_json(ws: WebSocket, payload: dict[str, Any]) -> bool:
    try:
        if ws.client_state == WebSocketState.DISCONNECTED:
            return False
        await ws.send_json(payload)
        return True
    except Exception:
        return False


async def _safe_send_json_locked(
    ws: WebSocket, payload: dict[str, Any], lock: asyncio.Lock
) -> bool:
    async with lock:
        return await _safe_send_json(ws, payload)


async def _safe_send_bytes(ws: WebSocket, payload: bytes) -> bool:
    try:
        if ws.client_state == WebSocketState.DISCONNECTED:
            return False
        await ws.send_bytes(payload)
        return True
    except Exception:
        return False


async def _safe_send_bytes_locked(
    ws: WebSocket, payload: bytes, lock: asyncio.Lock
) -> bool:
    async with lock:
        return await _safe_send_bytes(ws, payload)


async def _safe_close(ws: WebSocket, code: int) -> bool:
    if (
        ws.client_state == WebSocketState.DISCONNECTED
        or ws.application_state == WebSocketState.DISCONNECTED
    ):
        return False
    try:
        await ws.close(code=code)
        return True
    except RuntimeError:
        # A client disconnect or another task may close the socket between
        # the state check and the close frame.
        return False


def _is_live_config_compatibility_error(exc: Exception) -> bool:
    """Only retry errors that indicate an unsupported optional config field."""
    code = getattr(exc, "code", None)
    message = str(exc).lower()
    return (
        code in (400, "400", "INVALID_ARGUMENT")
        and any(term in message for term in ("language", "transcription", "thinking"))
    )


def _greeting_prompt(language: str) -> str:
    _, _, kind = _language_profile(language)
    if kind == "si":
        return (
            "The customer just connected. Greet them in natural Sinhala with only: "
            "'ආයුබෝවන්! SLT-MOBITEL වෙත සාදරයෙන් පිළිගනිමු. මම ඔබේ AI සහායක, අද මම ඔබට උදව් කරන්නේ කෙසේද?'"
        )
    if kind == "ta":
        return (
            "The customer just connected. Greet them in natural Tamil with only: "
            "'வணக்கம்! SLT-MOBITEL இற்கு வரவேற்கிறோம். நான் உங்கள் AI உதவியாளர், இன்று உங்களுக்கு எவ்வாறு உதவலாம்?'"
        )
    return (
        "The customer just connected. Greet them warmly with only: "
        "'Hello! Welcome to SLT-MOBITEL. I am your AI Assistant, how can I help you today?'"
    )


def voice_live_router(assistant: AssistantService, settings: Settings) -> APIRouter:
    """Factory that binds AssistantService and Settings to the WebSocket route."""

    @router.websocket("/api/voice/live")
    async def voice_live_stream(
        websocket: WebSocket,
        session_id: str | None = None,
        language: str = "en-US",
    ) -> None:
        await websocket.accept()
        actual_session_id = session_id or str(uuid4())
        live_model = settings.gemini_live_model or _LIVE_MODEL
        logger.info(
            "Voice WS connected [session=%s lang=%s model=%s]",
            actual_session_id,
            language,
            live_model,
        )

        if not settings.google_api_key:
            logger.error("GOOGLE_API_KEY is not configured for Live API.")
            await _safe_send_json(websocket, {
                "type": "error",
                "message": "Google API key is not configured on the backend.",
            })
            await _safe_close(websocket, code=1008)
            return

        client = _get_genai_client(settings.google_api_key)
        configs = [
            _build_live_config(language, with_language_hint=True, with_zero_thinking=True),
            _build_live_config(language, with_language_hint=False, with_zero_thinking=True),
        ]

        session_cm = None
        session = None
        last_connect_error: Exception | None = None
        for config_index, cfg in enumerate(configs):
            if websocket.client_state == WebSocketState.DISCONNECTED:
                logger.info(
                    "Client disconnected before Gemini Live session established [session=%s]",
                    actual_session_id,
                )
                await _safe_close(websocket, code=1000)
                return

            try:
                session_cm = client.aio.live.connect(model=live_model, config=cfg)
                session = await asyncio.wait_for(
                    session_cm.__aenter__(), timeout=_LIVE_CONNECT_TIMEOUT
                )
                last_connect_error = None
                break
            except Exception as exc:
                last_connect_error = exc
                logger.warning(
                    "Gemini Live connect attempt %d failed [session=%s]: %r",
                    config_index + 1,
                    actual_session_id,
                    exc,
                )
                if session_cm is not None:
                    try:
                        await session_cm.__aexit__(None, None, None)
                    except Exception:
                        pass
                    session_cm = None
                session = None

        if session is None or session_cm is None:
            if websocket.client_state == WebSocketState.DISCONNECTED:
                logger.info(
                    "Client disconnected while connecting to Live API [session=%s]",
                    actual_session_id,
                )
                return

            logger.error(
                "Live session connection error [session=%s]: %r",
                actual_session_id,
                last_connect_error,
            )
            await _safe_send_json(websocket, {
                "type": "error",
                "message": "Voice service is temporarily unavailable. Please retry.",
            })
            await _safe_close(websocket, code=1011)
            return

        try:
            await _run_live_session(
                websocket=websocket,
                session=session,
                assistant=assistant,
                actual_session_id=actual_session_id,
                live_model=live_model,
                language=language,
            )
        except WebSocketDisconnect:
            logger.info("Client disconnected [session=%s]", actual_session_id)
        except RuntimeError as rt_exc:
            if "disconnect message has been received" in str(rt_exc):
                logger.info("Client disconnected [session=%s]", actual_session_id)
            else:
                logger.error(
                    "Live session connection error [session=%s]: %s",
                    actual_session_id,
                    rt_exc,
                    exc_info=True,
                )
        except Exception as exc:
            logger.error(
                "Live session connection error [session=%s]: %s",
                actual_session_id,
                exc,
                exc_info=True,
            )
            await _safe_send_json(websocket, {
                "type": "error",
                "message": "Voice service is temporarily unavailable. Please retry.",
            })
        finally:
            try:
                await session_cm.__aexit__(None, None, None)
            except Exception:
                pass
            await _safe_close(websocket, code=1000)
            logger.info("Voice session closed [session=%s]", actual_session_id)

    return router


async def _run_live_session(
    websocket: WebSocket,
    session: Any,
    assistant: AssistantService,
    actual_session_id: str,
    live_model: str,
    language: str,
) -> None:
    # Single send lock protects WebSocket frame serialization
    send_lock = asyncio.Lock()

    async def _send_json(payload: dict[str, Any]) -> bool:
        return await _safe_send_json_locked(websocket, payload, send_lock)

    async def _send_bytes(payload: bytes) -> bool:
        return await _safe_send_bytes_locked(websocket, payload, send_lock)

    await _send_json({
        "type": "ready",
        "session_id": actual_session_id,
        "model": live_model,
        "inputSampleRate": 16000,
        "outputSampleRate": 24000,
    })
    await _send_json({
        "type": "turn_start",
        "speaker": "assistant",
        "detail": "greeting",
    })

    provider_send_lock = asyncio.Lock()
    cancelled_tool_ids: set[str] = set()
    tool_tasks: set[asyncio.Task[Any]] = set()
    turn_state = {
        "speaker": "idle",
        "user_text": "",
        "assistant_text": "",
        "is_greeting": True,
    }
    interrupted_event = asyncio.Event()
    turn_generation = 0

    def _spawn_tool_task(coro: Any) -> None:
        task = asyncio.create_task(coro)
        tool_tasks.add(task)
        task.add_done_callback(tool_tasks.discard)

    def _invalidate_turn() -> None:
        nonlocal turn_generation
        turn_generation += 1
        interrupted_event.set()
        for task in list(tool_tasks):
            task.cancel()

    async def _send_initial_greeting() -> None:
        try:
            await asyncio.sleep(0.15)
            async with provider_send_lock:
                await session.send_client_content(
                    turns=[
                        types.Content(
                            role="user",
                            parts=[types.Part.from_text(text=_greeting_prompt(language))],
                        )
                    ],
                    turn_complete=True,
                )
            logger.info("Triggered initial greeting [session=%s]", actual_session_id)
        except Exception as greet_exc:
            logger.warning("Could not trigger greeting: %s", greet_exc)

    async def _emit_user_transcript(text: str, *, interim: bool = False) -> None:
        payload: dict[str, Any] = {
            "type": "transcript",
            "role": "user",
            "text": text,
            "interim": interim,
        }
        await _send_json(payload)

    async def _emit_assistant_transcript(text: str) -> None:
        await _send_json({
            "type": "transcript",
            "role": "assistant",
            "text": text,
        })

    async def _begin_user_turn() -> None:
        if turn_state["speaker"] in ("assistant", "idle"):
            turn_state["user_text"] = ""
            turn_state["assistant_text"] = ""
            turn_state["speaker"] = "user"
            await _send_json({
                "type": "turn_start",
                "speaker": "user",
            })

    async def _begin_assistant_turn() -> None:
        if turn_state["speaker"] != "assistant":
            turn_state["assistant_text"] = ""
            turn_state["speaker"] = "assistant"
            await _send_json({
                "type": "turn_start",
                "speaker": "assistant",
            })

    async def _handle_tool_call(tool_call: Any, generation: int) -> None:
        function_responses: list[types.FunctionResponse] = []
        for fc in tool_call.function_calls or []:
            if generation != turn_generation or (fc.id and fc.id in cancelled_tool_ids):
                continue
            if fc.name != "query_slt_knowledge":
                continue

            query_arg = (fc.args or {}).get("query", "")
            logger.info(
                "RAG tool call: query_slt_knowledge('%s') [session=%s]",
                query_arg,
                actual_session_id,
            )
            await _send_json({
                "type": "status",
                "state": "thinking",
                "detail": f"Searching knowledge: {query_arg}",
            })

            try:
                context_text, sources = await asyncio.to_thread(
                    assistant.retrieve_context, query_arg, 2
                )
                context_text = _trim_voice_context(context_text, limit=_VOICE_CONTEXT_CHARS)
                if sources:
                    await _send_json({
                        "type": "sources",
                        "sources": [
                            {"title": s.title, "category": s.category}
                            for s in sources
                        ],
                    })
            except Exception as exc:
                logger.warning("RAG retrieval error: %s", exc)
                context_text = (
                    "Information could not be retrieved at this moment. "
                    "Advise the customer to contact SLT customer care on 1212."
                )

            if generation != turn_generation or (fc.id and fc.id in cancelled_tool_ids):
                continue
            if generation != turn_generation or interrupted_event.is_set():
                logger.info("Dropping tool response due to barge-in [session=%s]", actual_session_id)
                return

            function_responses.append(
                types.FunctionResponse(
                    name=fc.name,
                    id=fc.id,
                    response={"result": context_text},
                )
            )

        if (
            not function_responses
            or interrupted_event.is_set()
            or generation != turn_generation
        ):
            return

        turn_state["assistant_text"] = ""
        turn_state["speaker"] = "assistant"
        async with provider_send_lock:
            await session.send_tool_response(function_responses=function_responses)
        await _send_json({
            "type": "status",
            "state": "thinking",
            "detail": "Formatting response...",
        })

    async def forward_client_to_gemini() -> None:
        while True:
            if websocket.client_state == WebSocketState.DISCONNECTED:
                break
            try:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break

                raw_bytes = msg.get("bytes")
                if raw_bytes:
                    if turn_state.get("is_greeting") or turn_state["speaker"] == "assistant":
                        continue
                    async with provider_send_lock:
                        await session.send_realtime_input(
                            audio=types.Blob(
                                data=raw_bytes,
                                mime_type="audio/pcm;rate=16000",
                            )
                        )
                    continue

                raw_text = msg.get("text")
                if not raw_text:
                    continue

                try:
                    payload = json.loads(raw_text)
                except Exception:
                    payload = {"type": "text", "text": raw_text}

                msg_type = payload.get("type")

                if msg_type == "audio":
                    if turn_state.get("is_greeting") or turn_state["speaker"] == "assistant":
                        continue
                    b64_data = payload.get("data", "")
                    if b64_data:
                        pcm_bytes = base64.b64decode(b64_data)
                        async with provider_send_lock:
                            await session.send_realtime_input(
                                audio=types.Blob(
                                    data=pcm_bytes,
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )

                elif msg_type == "interrupt":
                    logger.info("Client requested interrupt [session=%s]", actual_session_id)
                    turn_state["is_greeting"] = False
                    _invalidate_turn()
                    turn_state["speaker"] = "idle"
                    turn_state["user_text"] = ""
                    turn_state["assistant_text"] = ""
                    interrupted_event.clear()
                    await _send_json({"type": "interrupted"})
                    continue

                elif msg_type == "text":
                    user_text = payload.get("text", "")
                    if user_text:
                        _invalidate_turn()
                        turn_state["user_text"] = user_text
                        turn_state["assistant_text"] = ""
                        turn_state["speaker"] = "user"
                        interrupted_event.clear()
                        await _send_json({
                            "type": "turn_start",
                            "speaker": "user",
                        })
                        await _emit_user_transcript(user_text)
                        async with provider_send_lock:
                            await session.send_client_content(
                                turns=[
                                    types.Content(
                                        role="user",
                                        parts=[types.Part.from_text(text=user_text)],
                                    )
                                ],
                                turn_complete=True,
                            )

                elif msg_type == "end":
                    logger.info("Client requested end [session=%s]", actual_session_id)
                    break

            except WebSocketDisconnect:
                break
            except RuntimeError as rt_exc:
                if "disconnect message has been received" in str(rt_exc):
                    break
                logger.warning("client->gemini runtime error [session=%s]: %s", actual_session_id, rt_exc)
                break
            except asyncio.CancelledError:
                break
            except (
                websockets.exceptions.ConnectionClosedError,
                websockets.exceptions.ConnectionClosedOK,
            ):
                logger.warning(
                    "Gemini connection lost during audio relay [session=%s]",
                    actual_session_id,
                )
                break
            except genai_errors.APIError as api_exc:
                logger.warning(
                    "Gemini API error during audio relay [session=%s]: %s",
                    actual_session_id,
                    api_exc,
                )
                break
            except Exception as exc:
                logger.warning("client->gemini error [session=%s]: %s", actual_session_id, exc)
                break

    async def forward_gemini_to_client() -> None:
        while True:
            try:
                async for response in session.receive():
                    if getattr(response, "go_away", None) is not None:
                        await _send_json({
                            "type": "disconnected",
                            "code": 1013,
                            "message": "Voice session is rotating. Reconnecting...",
                        })
                        return

                    cancellation = getattr(response, "tool_call_cancellation", None)
                    if cancellation is not None and cancellation.ids:
                        cancelled_tool_ids.update(cancellation.ids)

                    server_content = response.server_content
                    if server_content is not None:
                        if server_content.interrupted:
                            logger.info("Barge-in detected [session=%s]", actual_session_id)
                            turn_state["is_greeting"] = False
                            _invalidate_turn()
                            turn_state["speaker"] = "user"
                            turn_state["user_text"] = ""
                            turn_state["assistant_text"] = ""
                            await _send_json({"type": "interrupted"})
                            continue

                        interim = getattr(server_content, "interim_input_transcription", None)
                        if interim is not None:
                            t_text = getattr(interim, "text", "") or ""
                            if t_text:
                                interrupted_event.clear()
                                await _begin_user_turn()
                                turn_state["user_text"] = _merge_transcript(
                                    turn_state["user_text"], t_text
                                )
                                await _emit_user_transcript(
                                    turn_state["user_text"].strip(), interim=True
                                )

                        if server_content.input_transcription:
                            t_text = getattr(server_content.input_transcription, "text", "") or ""
                            if t_text:
                                interrupted_event.clear()
                                await _begin_user_turn()
                                turn_state["user_text"] = _merge_transcript(
                                    turn_state["user_text"], t_text
                                )
                                await _emit_user_transcript(turn_state["user_text"].strip())

                        if server_content.output_transcription:
                            t_text = getattr(server_content.output_transcription, "text", "") or ""
                            if t_text:
                                interrupted_event.clear()
                                await _begin_assistant_turn()
                                turn_state["assistant_text"] = _merge_transcript(
                                    turn_state["assistant_text"], t_text
                                )
                                await _emit_assistant_transcript(
                                    turn_state["assistant_text"].strip()
                                )

                        if server_content.model_turn is not None and not interrupted_event.is_set():
                            await _begin_assistant_turn()
                            for part in server_content.model_turn.parts or []:
                                if part.inline_data and part.inline_data.data:
                                    await _send_bytes(part.inline_data.data)

                        if server_content.turn_complete:
                            turn_state["is_greeting"] = False
                            if turn_state["user_text"].strip():
                                await _emit_user_transcript(
                                    turn_state["user_text"].strip(), interim=False
                                )
                            if turn_state["assistant_text"].strip():
                                await _emit_assistant_transcript(
                                    turn_state["assistant_text"].strip()
                                )
                            turn_state["speaker"] = "idle"
                            interrupted_event.clear()
                            await _send_json({
                                "type": "turn_complete",
                                "user_transcript": turn_state["user_text"].strip(),
                                "assistant_transcript": turn_state["assistant_text"].strip(),
                            })

                    if response.tool_call is not None and not interrupted_event.is_set():
                        _spawn_tool_task(_handle_tool_call(response.tool_call, turn_generation))

            except WebSocketDisconnect:
                break
            except RuntimeError as rt_exc:
                if "disconnect message has been received" in str(rt_exc):
                    break
                logger.warning("gemini->client runtime error [session=%s]: %s", actual_session_id, rt_exc)
                break
            except asyncio.CancelledError:
                break
            except genai_errors.APIError as api_exc:
                if getattr(api_exc, "code", None) == 1006:
                    logger.warning(
                        "Gemini Live dropped (1006) [session=%s] - signalling client reconnect",
                        actual_session_id,
                    )
                    await _send_json({
                        "type": "disconnected",
                        "code": 1006,
                        "message": "Voice connection dropped. Reconnecting...",
                    })
                else:
                    logger.error(
                        "Gemini API error [session=%s]: %s",
                        actual_session_id,
                        api_exc,
                        exc_info=True,
                    )
                    await _send_json({
                        "type": "error",
                        "message": "Voice service is temporarily unavailable. Please retry.",
                    })
                break
            except (
                websockets.exceptions.ConnectionClosedError,
                websockets.exceptions.ConnectionClosedOK,
            ) as ws_exc:
                logger.warning(
                    "WebSocket to Gemini closed [session=%s]: %s",
                    actual_session_id,
                    ws_exc,
                )
                await _send_json({
                    "type": "disconnected",
                    "code": 1006,
                    "message": "Connection lost. Reconnecting...",
                })
                break
            except Exception as exc:
                logger.error(
                    "gemini->client error [session=%s]: %s",
                    actual_session_id,
                    exc,
                    exc_info=True,
                )
                await _send_json({
                    "type": "error",
                    "message": "Voice streaming interrupted. Please retry.",
                })
                break

    client_task = asyncio.create_task(forward_client_to_gemini())
    gemini_task = asyncio.create_task(forward_gemini_to_client())
    greeting_task = asyncio.create_task(_send_initial_greeting())

    _done, pending = await asyncio.wait(
        [client_task, gemini_task],
        return_when=asyncio.FIRST_COMPLETED,
    )
    if not greeting_task.done():
        greeting_task.cancel()
    for task in pending | tool_tasks:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    await _safe_close(websocket, code=1000)
