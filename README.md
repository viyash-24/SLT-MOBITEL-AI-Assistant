# SLT-MOBITEL AI Assistant

Customer support application with text chat and a live interactive voice avatar for SLT-MOBITEL customers.

## Overview

- **Text Chat:** Intelligent conversational support powered by Google Gemini, grounded in SLT-MOBITEL broadband, mobile, fiber, and telecom knowledge with PostgreSQL/pgvector RAG.
- **Voice Avatar:** Full-duplex real-time voice communication powered by Google Gemini Live API (`gemini-2.5-flash-native-audio-latest`), featuring a 60 FPS HTML5 Canvas face avatar with real-time lip synchronization, natural blinking, head micro-movements, and dynamic visual energy rings.

## Setup

- Follow [backend setup](backend/README.md) for the FastAPI service and PostgreSQL knowledge base.
- Follow [frontend setup](frontend/README.md) for the Next.js application.

## Voice Avatar Experience

1. Click **Talk to SLT Avatar** from the home screen or navigate to `/voice`.
2. Choose your language (**English**, **Sinhala**, **Tamil**) and click **Start**.
3. Allow microphone access.
4. Speak naturally to the SLT Avatar:
   - Near-instantaneous response times with streaming audio.
   - Realistic 60 FPS canvas lip-sync tracking live speech amplitude.
   - Synchronized live transcription in the **You** and **Agent** panels.
   - Support for natural barge-in interruptions and microphone muting.
