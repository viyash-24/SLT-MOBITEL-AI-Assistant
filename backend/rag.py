from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from langchain_core.documents import Document
from langchain_postgres import PGVector

from chat import generate_answer
from config import Settings, get_settings
from database import database_ready, save_chat_exchange
from embeddings import create_embeddings
from knowledge_base.ingest import ingest_knowledge_base, load_knowledge_documents
from schemas import ChatRequest, ChatResponse, Source


DATA_DIR = Path(__file__).resolve().parent / "knowledge_base" / "data"

# Load documents at import time for the keyword fallback search.
# Wrapped in try/except so a missing data file does not crash the server
# on startup — the vector-store path will still work if the DB is populated.
try:
    KNOWLEDGE_BASE: list[Document] = load_knowledge_documents(DATA_DIR)
except FileNotFoundError as _kb_err:
    import warnings
    warnings.warn(
        f"Knowledge-base file missing at startup: {_kb_err}. "
        "Run ingestion first: python -m knowledge_base.ingest",
        stacklevel=1,
    )
    KNOWLEDGE_BASE = []


class RagService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._cached_vector_store: PGVector | None = None

    def _require_configuration(self) -> None:
        if not self.settings.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY is not configured")
        if not self.settings.database_configured:
            raise RuntimeError("DATABASE_URL is not configured")

    def database_ready(self) -> bool:
        return database_ready(self.settings)

    def _vector_store(self) -> PGVector:
        # Cache the PGVector instance so we don't create a new connection on
        # every similarity_search call (saves ~200 ms per RAG tool invocation).
        if self._cached_vector_store is None:
            self._cached_vector_store = PGVector(
                embeddings=create_embeddings(self.settings),
                collection_name=self.settings.pgvector_collection,
                connection=self.settings.database_url,
                use_jsonb=True,
            )
        return self._cached_vector_store

    def reindex(self) -> int:
        self._require_configuration()
        counts = ingest_knowledge_base(self.settings)
        self._cached_vector_store = None
        # Refresh the module-level fallback list after re-ingestion
        global KNOWLEDGE_BASE
        try:
            KNOWLEDGE_BASE = load_knowledge_documents(DATA_DIR)
        except Exception:
            pass
        return sum(counts.values())

    def _fallback_search(self, query: str, k: int = 5) -> list[Document]:
        """Keyword-based ranking fallback used when vector store is unavailable.

        Features:
        - Stop-word filtering for question grammar words
        - Retains digits for package numbers (e.g. LTE Unlimited 2, Flash 5)
        - Bigram scoring for multi-word phrases (e.g. 'connection charge')
        - High-weight scoring on title and category metadata
        """
        import re

        stop_words = {
            "what", "is", "the", "for", "are", "can", "my", "in", "to", "do", "how",
            "an", "of", "and", "or", "it", "on", "at", "by", "with", "about", "a",
            "i", "me", "you", "your", "we", "our", "that", "this", "there", "from",
        }

        all_tokens = [
            t for t in re.findall(r"[a-z0-9]+", query.lower())
            if len(t) >= 2 or t.isdigit()
        ]
        if not all_tokens:
            return []

        meaningful = [t for t in all_tokens if t not in stop_words]
        tokens = meaningful if meaningful else all_tokens

        query_lower = query.lower().strip()
        bigrams = [f"{tokens[i]} {tokens[i+1]}" for i in range(len(tokens) - 1)]

        scored_documents: list[tuple[float, Document]] = []

        for document in KNOWLEDGE_BASE:
            content_lower = document.page_content.lower()
            title_lower = str(document.metadata.get("title", "")).lower()
            category_lower = str(document.metadata.get("category", "")).lower()

            score = 0.0

            # Exact multi-token phrase match
            if len(tokens) > 1 and query_lower in content_lower:
                score += 30.0
            if len(tokens) > 1 and query_lower in title_lower:
                score += 40.0

            # Bigram matches
            for bg in bigrams:
                if bg in title_lower:
                    score += 15.0
                elif bg in content_lower:
                    score += 8.0

            # Token-level matches
            for t in tokens:
                if t.isdigit():
                    if t in title_lower:
                        score += 8.0
                    elif re.search(r"\b" + re.escape(t) + r"\b", content_lower):
                        score += 4.0
                    continue

                c_count = content_lower.count(t)
                if c_count:
                    score += min(c_count, 4) * 2.0
                if t in title_lower:
                    score += 8.0
                if t in category_lower:
                    score += 4.0

            if score > 0:
                scored_documents.append((score, document))

        scored_documents.sort(key=lambda item: item[0], reverse=True)
        return [document for _, document in scored_documents[:k]]

    def chat(self, request: ChatRequest) -> ChatResponse:
        """Process chat request via the shared AssistantService."""
        from app.dependencies import get_assistant_service
        from app.domain.models.chat import AssistantRequest, ChatTurn

        assistant = get_assistant_service()
        domain_req = AssistantRequest(
            message=request.message,
            history=[ChatTurn(role=t.role, content=t.content) for t in request.history],
            session_id=request.session_id,
            channel="text",
        )
        result = assistant.answer(domain_req)
        return ChatResponse(
            session_id=result.session_id,
            answer=result.answer,
            sources=[Source(title=s.title, category=s.category) for s in result.sources],
            confidence=result.confidence,
        )


@lru_cache
def get_rag_service() -> RagService:
    return RagService(get_settings())
