# SLT-MOBITEL AI Assistant Frontend

Next.js frontend for the SLT-MOBITEL AI Assistant. The application provides text chat, real-time voice chat, chat history, source references, language selection, and light/dark themes.

## Features

- Text chat with the SLT-MOBITEL AI Assistant backend.
- Voice AI agent powered by Google Gemini Multimodal Live API with continuous microphone streaming, instant speech responses, smooth 24kHz audio playback, and natural barge-in interruption.
- Multilingual conversations in English, Sinhala, and Tamil.
- Live voice subtitles, audio level visualizer, and verified knowledge-base source pills.
- Interactive AI avatar interface with state indicators and glowing audio aura.
- Persistent recent chat sessions using browser local storage.
- Source and confidence information for assistant responses.
- Responsive desktop and mobile layout.
- Light and dark theme support.

## Requirements

- Node.js 20 or newer is recommended.
- npm or another compatible JavaScript package manager.
- The backend API running locally or at a reachable URL.
- A modern browser with microphone support (Chrome, Edge, Safari).

## Installation

From the `frontend` directory, install dependencies:

```powershell
npm install
```

Create `.env.local` in the `frontend` directory when the backend is not running at the default URL:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The frontend uses `http://localhost:8000` by default, so this file is optional for the standard local setup.

## Run Locally

Start the backend first from the `backend` directory. Follow [the backend setup guide](../backend/README.md), then run:

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload
```

In a second terminal, start the frontend from the `frontend` directory:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

## Available Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Create a production build. |
| `npm start` | Serve the production build. Run `npm run build` first. |
| `npm run lint` | Run ESLint checks. |

## Voice Agent

The Voice Agent uses browser-native speech APIs and connects directly to the backend RAG pipeline:

1. Click **Talk to Voice Agent** on the main page to open `/voice`.
2. Select your conversation language (English, Sinhala, or Tamil).
3. Allow microphone access when prompted.
4. Speak your question — the voice agent recognizes your speech in real time, queries the SLT knowledge base, and speaks the answer aloud while displaying verified knowledge sources.
