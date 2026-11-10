# SLT-MOBITEL AI Assistant

Customer support application with text chat and a live Tavus avatar. In voice mode, Tavus is the sole speaking assistant: it receives microphone audio, generates the response, and streams its human-like face and synchronized voice directly into the application.

## Setup

- Follow [backend setup](backend/README.md) for the FastAPI service and text-chat knowledge base.
- Follow [frontend setup](frontend/README.md) for the Next.js application.
- Configure `TAVUS_API_KEY` and `TAVUS_PAL_ID` on the backend. The PAL must have the intended face, voice, SLT-MOBITEL instructions, and verified knowledge configured in Tavus. `TAVUS_REPLICA_ID` optionally overrides its face.

Never put the Tavus API key in a `NEXT_PUBLIC_*` variable. Tavus requires an account with available conversation credits. Microphone access requires HTTPS or localhost.

## Voice experience

Open **Talk to SLT Avatar**, choose the language, and select **Start conversation**. Allow microphone access and speak naturally to SLT Avatar. The avatar's real video and audio play in one media element. Mute controls the actual microphone track; End conversation releases media and ends the Tavus session. A browser playback restriction shows an explicit button to enable avatar audio/video.

The application uses Daily's headless WebRTC SDK as Tavus's transport. Users remain in the application; no hosted call-room interface, iframe, or separate voice assistant appears. The old Gemini Live endpoint is retired, and there is no static-photo lip animation fallback.

Tavus voice knowledge is configured on the PAL. Text chat continues to use the backend RAG service; its database is not automatically synchronized into Tavus. Sinhala requires a compatible voice/STT configuration (see the backend guide).

See [voice architecture and validation](VOICE_AGENT_REPORT.md) for lifecycle details and the live acceptance checklist.
