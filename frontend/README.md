# SLT-MOBITEL AI Assistant Frontend

Next.js application featuring text chat with RAG knowledge retrieval, persistent chat sessions, language selection, light/dark themes, and an interactive real-time voice avatar.

## Run Locally

Use Node.js 20 or newer, and start the [backend](../backend/README.md) on port 8000.

```sh
npm install
npm run dev
```

Open http://localhost:3000. For a different backend address, set `NEXT_PUBLIC_API_URL` in `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Voice Avatar

1. Open `/voice` (or click **Talk to SLT Avatar** from the home screen).
2. Choose your preferred language (English, Sinhala, Tamil) and click **Start**.
3. Allow microphone access.
4. Speak naturally to the SLT Avatar:
   - Full-duplex real-time streaming powered by Google Gemini Live API.
   - Realistic 60 FPS lip-synchronized face canvas tracking the spoken audio envelope in real time.
   - Natural eye blinking, breathing micro-movements, and dynamic aura visual energy rings.
   - Live transcription for both **You** and the **Agent**.
5. Use **Mute** to mute your microphone, **Interrupt** to cut off speech and ask a new question, or **Stop** to end the session.

## Checks

```sh
npm run lint
npm run build
```
