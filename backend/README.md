# SLT-MOBITEL AI Assistant API

FastAPI service for retrieval-augmented answers about predefined SLT-MOBITEL information.

## Structure

```text
backend/
├── main.py          # FastAPI application
├── chat.py          # Gemini answer generation
├── rag.py           # Retrieval-augmented generation process
├── embeddings.py    # Gemini embeddings
├── prompt.py        # Gemini prompt templates
├── database.py      # PostgreSQL readiness checks
├── config.py        # Environment variables
├── requirements.txt # Python packages
├── .env             # Local API keys and database URL
└── knowledge_base/
  └── data/
    ├── SLT_FAQ_V4.json
    └── SLT_Package_Details_New_Connection_Charges_V1_2.json
```

## Run locally

1. Create a virtual environment and install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Install and start a local PostgreSQL server with the `pgvector` extension.
3. Create a `.env` file, then set `GOOGLE_API_KEY` and update `DATABASE_URL` with your local PostgreSQL credentials.
4. Create the `vector` extension in the configured database if it is not already enabled:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

5. Index the bundled knowledge base:

```powershell
python -m knowledge_base.ingest
```

6. Start the API from the `backend` directory:

```powershell
uvicorn main:app --reload
```

The API is available at `http://localhost:8000`. Open `/docs` for the interactive API documentation.

## Endpoints

- `GET /api/health` - service, configuration, and PostgreSQL readiness status
- `POST /api/chat` - answer a question using retrieved knowledge (supports both `"text"` and `"voice"` channels)
- `POST /api/knowledge/reindex` - replace the pgvector collection with bundled knowledge
- `GET /api/tavus/status` - local Tavus configuration status (does not check credits or provider reachability)
- `POST /api/tavus/conversation` - create the sole voice assistant session
- `POST /api/tavus/conversation/end` - terminate that session

The retired Gemini voice WebSocket `/api/voice/live` closes with a refresh message;
`/api/livekit/token` returns HTTP 410. Neither can start another speaking assistant.

Example request:

```json
{
  "message": "What is the rental for Fiber Starter?",
  "history": [],
  "channel": "text"
}
```

## Tavus avatar configuration

The voice page uses one Tavus full-pipeline PAL for hearing, reasoning, speech,
and synchronized facial animation. The frontend joins the returned
`conversation_url` through Daily's call object and renders its audio/video tracks
inside the app. It does not open a hosted call room or start Gemini audio.

Set these **server-side** values in `backend/.env`:

```dotenv
TAVUS_API_KEY=your_tavus_api_key
TAVUS_PAL_ID=your_slt_mobitel_pal_id
# Optional; omit to keep the PAL's configured default face:
TAVUS_REPLICA_ID=your_tavus_face_id
```

Create/configure the PAL in Tavus with `pipeline_mode: full`, a realistic default
face, and the SLT-MOBITEL customer support identity. The API sends current
`pal_id` and optional `face_id` fields; the existing `TAVUS_REPLICA_ID` environment
variable remains supported. An explicit PAL is required, so missing configuration
cannot silently select an unrelated stock assistant.

Attach verified SLT-MOBITEL knowledge to that PAL in Tavus, including the facts in
`knowledge_base/data/SLT_FAQ_V4.json` and
`knowledge_base/data/SLT_Package_Details_New_Connection_Charges_V1_2.json` (convert
to a Tavus-supported document format if required). The backend's `/api/chat`
retrieval and PostgreSQL index are **not automatically available to Tavus**.
Keep Tavus documents current when package information changes. The session
context tells the PAL to use verified attached knowledge and refer unanswered
questions to 1212 rather than inventing prices or account details.

The create endpoint accepts `language: "EN" | "SI" | "TA"` (default `EN`) and
passes it to Tavus as `properties.languages`. English and Tamil are supported by
the default Tavus TTS routing. **Sinhala requires a PAL TTS configuration that
supports Sinhala**, such as Tavus's Azure Speech integration with an East US
resource and an appropriate voice. A language unsupported by the configured PAL
is rejected by Tavus and shown as a session error; the app never switches to a
second voice service. Check the current [Tavus language support guide](https://docs.tavus.io/sections/conversational-video-interface/language-support).

Session creation enables closed captions and video, uses a 30-minute maximum,
and stops unattended calls after a short timeout. `meeting_token` is returned
when supplied by Tavus for authenticated rooms. Ending a missing/already-ended
session is idempotent; other provider failures are reported for cleanup retries.

No live avatar can be verified without valid Tavus credentials, an enabled PAL
and face, available conversation credits, and browser microphone permission.
To verify the integration, ask one question in the voice page and confirm the
single embedded avatar answers with synchronized audio/video, then mute and end
the session. There should be no `/api/voice/live` connection or hosted room UI.

Run provider-mocked route and retired-voice coverage with
`python -m unittest test_tavus test_voice_routes -v` from `backend/`.
