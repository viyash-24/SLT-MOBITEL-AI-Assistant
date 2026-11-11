# SLT-MOBITEL Voice Avatar Architecture

## Architecture Overview

The voice interface delivers real-time two-way voice conversations with SLT Avatar using Google Gemini Live API and an interactive 60 FPS HTML5 Canvas face avatar.

```text
Browser Microphone (16 kHz PCM)
    │
    ▼ (WebSocket /api/voice/live)
FastAPI Backend (Clean Architecture)
    │
    ▼ (Bidirectional streaming)
Google Gemini Live API (gemini-2.5-flash-native-audio-latest)
    │
    ▼ (24 kHz PCM Downlink + Transcripts)
FastAPI Backend
    │
    ▼ (WebSocket frames)
Browser Web Audio API (Jitter-buffered AudioContext)
    │
    ├──▶ 24 kHz Audio Playback (Speaker)
    ├──▶ RMS Audio Level Calculation
    │       │
    │       ▼
    │   60 FPS Canvas Lip-Sync Engine (AvatarFaceView)
    │   (Jaw drop, oral cavity, teeth arch, tongue contour, blinking, head micro-movements)
    │
    └──▶ Real-time Transcription Cards (You / Agent)
```

## Key Capabilities

1. **Full-Duplex Communication:** Continuous two-way conversation with natural barge-in interruption support.
2. **Real-Time Lip Synchronization:** Spring-damper speech envelope smoothing translates live audio energy into realistic mouth, jaw, teeth, and tongue movements at 60 FPS.
3. **Natural Facial Animation:** Realistic eyelid blinking cycles (~3.5–5s) and subtle head micro-nodding/tilting.
4. **Dynamic Visual Aura:** Pulsing energy rings react to speech intensity and reflect conversation states (`listening`, `speaking`, `thinking`).
5. **Accurate Transcripts:** Bidirectional streaming transcripts update the **You** and **Agent** transcript cards in real time.
