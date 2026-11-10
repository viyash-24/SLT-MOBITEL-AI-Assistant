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
- `WebSocket /api/voice/live` - real-time bidirectional audio stream powered by Gemini Multimodal Live API (`gemini-2.5-flash-native-audio-latest`) with continuous 16kHz PCM input, 24kHz PCM output, live barge-in interruption, and RAG knowledge tool grounding (`query_slt_knowledge`)

Example request:

```json
{
  "message": "What is the rental for Fiber Starter?",
  "history": [],
  "channel": "text"
}
```
