# SLT-MOBITEL AI Assistant API

FastAPI service for retrieval-augmented answers about predefined SLT-MOBITEL information.

## Structure

```text
backend/
├── main.py          # FastAPI application
├── chat.py          # Gemini answer generation
├── rag.py           # Retrieval-augmented generation process
├── embeddings.py    # Gemini embeddings
├── prompt.py        # Gemini prompt
├── database.py      # PostgreSQL readiness checks
├── config.py        # Environment variables
├── requirements.txt # Python packages
├── .env             # Local API keys and database URL
└── knowledge_base/
  └── data/
    ├── mobile_packages.txt
    ├── broadband_packages.txt
    ├── fibre_packages.txt
    ├── roaming.txt
    └── faq.txt
```

## Run locally

1. Create a virtual environment and install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Install and start a local PostgreSQL server with the `pgvector` extension.
3. Create a `.env` file, then set `GOOGLE_API_KEY` and update `DATABASE_URL` with your
  local PostgreSQL credentials.
4. Create the `vector` extension in the configured database if it is not already enabled:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

5. Index the bundled knowledge base:

```powershell
python -m app.seed
```

6. Start the API from the `backend` directory:

```powershell
uvicorn main:app --reload
```

7. For LiveKit voice sessions with the realistic Tavus human avatar, configure
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_ROOM`, and
`TAVUS_API_KEY` (with optional `TAVUS_FACE_ID` and `TAVUS_PAL_ID`) in `backend/.env`.
Then start the agent worker in a second backend terminal:

```powershell
.\.venv\Scripts\Activate.ps1
python livekit_agent.py start
```

The voice agent integrates the official `livekit-plugins-tavus` `AvatarSession`:
- When a user joins the room, the agent initiates an `AvatarSession` concurrently with the greeting.
- The Tavus agent participant (`tavus-avatar-agent`) joins the room and publishes lip-synchronized video and audio tracks.
- Spoken audio from Gemini Live is routed directly through Tavus data-stream audio output, eliminating lip-sync lag and double-audio playback.
- If `TAVUS_API_KEY` is omitted or unavailable, the agent falls back to voice-only mode automatically without crashing.

The API is available at `http://localhost:8000`. Open `/docs` for the interactive API documentation.

The API does not call Gemini during startup. Run the seed command once after PostgreSQL is
available and whenever the bundled knowledge base changes. Until then, `/api/health` reports
`degraded` and `/api/chat` returns a service-unavailable response rather than producing an
unverified answer.

## Endpoints

- `GET /api/health` - service, configuration, and PostgreSQL readiness status
- `POST /api/chat` - answer a question using retrieved knowledge
- `POST /api/knowledge/reindex` - replace the pgvector collection with bundled knowledge

Example request:

```json
{
  "message": "How do I activate roaming?",
  "history": []
}
```

The chat endpoint only answers from the five predefined knowledge documents in
`app/knowledge_base.py`. Unsupported questions are answered with a 1212 support referral.
