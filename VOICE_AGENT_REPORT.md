# Live AI Avatar Voice Agent Report

## 1. Executive Summary

The SLT-MOBITEL AI Assistant features a real-time **Live AI Avatar Voice Agent**. It replaces the legacy browser Web Speech API implementation with bidirectional audio streaming powered by **Gemini's Multimodal Live API** (`gemini-2.5-flash-native-audio-latest`), integrated real-time RAG knowledge retrieval, and a full-screen interactive virtual representative interface (**Kasuni**).

The application provides two unified interaction layers:

- **Normal Chat (`/`)**: Text-based customer support with streaming markdown responses, source citations, and session history.
- **Live AI Avatar (`/voice`)**: Real-time voice conversation with virtual SLT-MOBITEL customer-care representative Kasuni, featuring live speech-to-speech interaction, RAG grounding, natural interruption, audio visualizers, and multilingual support.

Both layers share the same SLT-MOBITEL knowledge base, PostgreSQL + pgvector vector store, session tracking, and database persistence.

---

## 2. Live Avatar Voice Architecture

```text
Browser Client                                    FastAPI Server                        Google Gemini
==============                                    ==============                        =============

Microphone (16kHz PCM)
        │
        ▼
   WebSocket ─────────────────────────────────► /api/voice/live
                                                      │
                                                      ├────────────────────────────► LiveConnect(AUDIO)
                                                      │                                     │
                                                      │  Tool Call: query_slt_knowledge     │
                                                      │◄────────────────────────────────────┤
                                                      │
                                             RagService (pgvector)
                                                      │
                                                      │  Tool Response (Verified Knowledge)
                                                      ├────────────────────────────►
                                                      │
                                                      │  24kHz PCM Audio & Transcripts
                                                      │◄────────────────────────────────────┤
                                                      │
AudioContext (24kHz) ◄──────────────────────── WebSocket
        │
        ▼
Avatar Animated Playback
(with instant interruption)
```

---

## 3. Real-Time Conversation Capabilities

- **Bidirectional Audio**: 16kHz PCM microphone audio captured via Web Audio API and streamed directly to Gemini Live; 24kHz synthesized audio streamed back to the browser and scheduled with zero-latency playback.
- **RAG Grounding**: The model is equipped with the `query_slt_knowledge` function declaration. When customers ask about packages, rates, or support, Gemini calls the tool, FastAPI executes similarity searches across PostgreSQL/pgvector, and returns verified knowledge.
- **Natural Interruption**: Speaking while the assistant is responding automatically triggers an interruption signal, stopping browser audio playback and immediately returning the avatar to the listening state.
- **Multilingual Support**: Supports English, Sinhala (සිංහල), and Tamil (தமிழ்) with dynamic prompt injection.
- **Visual Avatar States**:
  - `IDLE`: Avatar waiting, ready to connect.
  - `CONNECTING`: Establishing live connection.
  - `LISTENING`: Cyan pulsing ring, active microphone audio visualizer.
  - `THINKING`: Knowledge base search animation.
  - `SPEAKING`: Audio-reactive soundwave animation in sync with voice output.
  - `ERROR`: Friendly user alert with retry capability.
- **Session Persistence**: Exchanges during voice sessions are saved into the PostgreSQL `chat_messages` table.

---

## 4. Key Endpoints

### `GET /api/health`
Checks backend readiness, Gemini configuration, and PostgreSQL database status.

### `POST /api/chat`
Handles standard text chat requests with history, RAG retrieval, and citations.

### `WebSocket /api/voice/live?session_id={id}&language={lang}`
Real-time bidirectional WebSocket gateway between the client browser and Gemini Multimodal Live API. Handles 16kHz input audio, tool execution, interruption handling, and 24kHz output audio.