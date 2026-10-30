# SLT-MOBITEL AI Assistant Frontend

Next.js frontend for the SLT-MOBITEL AI Assistant. The application provides text chat, voice chat, chat history, source references, language selection, and light/dark themes.

## Features

- Text chat with the SLT-MOBITEL AI Assistant backend.
- LiveKit voice agent with Gemini native-audio streaming.
- Spoken responses and multilingual conversations in English, Sinhala, and Tamil.
- Live voice transcripts and verified knowledge-base source events.
- Realistic human video avatar powered by Tavus with lip-synchronized speech.
- Seamless fallback to static representative portrait when avatar video is offline or unconfigured.
- Persistent recent chat sessions using browser local storage.
- Source and confidence information for assistant responses.
- Responsive desktop and mobile layout.
- Light and dark theme support.

## Requirements

- Node.js 20 or newer is recommended.
- npm or another compatible JavaScript package manager.
- The backend API running locally or at a reachable URL.
- A modern browser with WebRTC and microphone support.

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

The Voice Agent uses LiveKit WebRTC media. The browser receives a short-lived room
token from the backend, publishes microphone audio, and subscribes to the backend
agent's Gemini native-audio response. LiveKit API credentials are never sent to the
browser.

1. Open the Voice Agent from the application.
2. Select **Start Conversation** or **Voice Chat**.
3. Allow microphone access when prompted.
4. Speak your question naturally.
5. The agent's audio response is streamed back through LiveKit.
6. Use the mute or end controls to manage the session.

| Language | Browser language code |
| --- | --- |
| English | `en-US` |
| Sinhala | `si-LK` |
| Tamil | `ta-LK` |

Voice availability depends on browser WebRTC support, microphone permissions, the
LiveKit deployment, Gemini model availability, and the running agent worker.

The 3D avatar uses the same HTML audio element that plays the subscribed LiveKit
track. An `AnalyserNode` measures RMS amplitude and drives a smoothed mouth-opening
animation, so it does not create a second audio playback path. This is amplitude-
based lip sync, not phoneme- or viseme-level synchronization. A future GLB avatar
with morph targets can be added to the isolated `Live3DAvatar` component if
viseme timing becomes available.

## Project Structure

```text
frontend/
├── app/
│   ├── components/       # Chat and voice UI components
│   ├── hooks/            # Reusable client hooks, including voice chat
│   ├── services/         # Backend API clients
│   ├── types/            # Shared frontend TypeScript types
│   ├── globals.css       # Application styles and responsive states
│   ├── layout.tsx        # Root layout and metadata
│   └── page.tsx          # Main application state and views
├── public/images/        # Public images and branding
├── eslint.config.mjs     # ESLint configuration
├── next.config.ts        # Next.js configuration
├── package.json          # Scripts and dependencies
└── README.md             # Frontend documentation
```

## API Integration

The frontend sends chat requests to:

```text
POST ${NEXT_PUBLIC_API_URL}/api/chat
```

Each request includes the current message, session ID, and recent conversation history. Voice input uses the same request format as text input; the frontend adds automatic speech playback for responses initiated through voice chat.

## Troubleshooting

### The assistant service cannot be reached

Confirm that the backend is running on port `8000`, or set the correct URL in `.env.local`. Restart the frontend after changing environment variables.

### Voice chat is unavailable

Check that the backend token endpoint is reachable, all `LIVEKIT_*` and
`GOOGLE_API_KEY` settings are configured, the agent worker is running, and
microphone permission has been granted.

### The backend returns a service-unavailable response

Check [http://localhost:8000/api/health](http://localhost:8000/api/health). The backend must have its API key, database, vector extension, and indexed knowledge base configured.

## Production Build

```powershell
npm run build
npm start
```

Set `NEXT_PUBLIC_API_URL` to the deployed backend URL before building the frontend.
