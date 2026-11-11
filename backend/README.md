# SLT-MOBITEL AI Assistant — Backend

FastAPI application delivering text chat and real-time live voice assistant capabilities for SLT-MOBITEL customers.

## Architecture

- **Clean Architecture:** Domain entities, application services, infrastructure adapters (Gemini, pgvector), and API route controllers.
- **RAG Pipeline:** Document chunking, Gemini embeddings, and PostgreSQL/pgvector semantic similarity search with keyword search fallback.
- **Live Voice Agent:** Full-duplex real-time audio communication powered by Google Gemini Live API (`gemini-2.5-flash-native-audio-latest`), featuring real-time speech synthesis, VAD turn detection, and 60 FPS lip-synchronized avatar animation.

## Setup

```powershell
# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt
```

### Environment Configuration

Configure `backend/.env`:

```dotenv
GOOGLE_API_KEY=your_google_api_key
DATABASE_URL=postgresql://user:password@localhost:5432/slt_assistant
CORS_ORIGINS=http://localhost:3000
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest
GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001
PGVECTOR_COLLECTION=slt_mobitel_knowledge
```

## Running the Server

```powershell
uvicorn main:app --reload
```

The API is available at `http://localhost:8000`. Open `/docs` for the interactive API documentation.

## Endpoints

- `GET /api/health` — service, configuration, and PostgreSQL readiness status
- `POST /api/chat` — answer a question using retrieved knowledge (supports text channels)
- `POST /api/knowledge/reindex` — replace the pgvector collection with bundled knowledge
- `WS /api/voice/live` — bidirectional WebSocket endpoint streaming 16 kHz PCM microphone input to Google Gemini Live API and receiving 24 kHz PCM audio and real-time transcription

## Tests

Run route and integration tests:

```powershell
python -m pytest test_voice_routes.py -v
```
