from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from langchain_core.documents import Document
from langchain_postgres import PGVector

from chat import generate_answer
from config import Settings, get_settings
from database import database_ready, save_chat_exchange
from embeddings import create_embeddings
from schemas import ChatRequest, ChatResponse, Source


DATA_DIR = Path(__file__).resolve().parent / "knowledge_base" / "data"
_DOCUMENT_METADATA = {
    "mobile_packages.txt": ("Mobile packages", "mobile"),
    "broadband_packages.txt": ("Broadband packages", "broadband"),
    "fibre_packages.txt": ("Fibre packages", "broadband"),
    "roaming.txt": ("International roaming", "roaming"),
    "faq.txt": ("Customer support FAQ", "support"),
}
KNOWLEDGE_BASE = [
    Document(
        page_content=(DATA_DIR / filename).read_text(encoding="utf-8"),
        metadata={"title": title, "category": category, "source": filename},
    )
    for filename, (title, category) in _DOCUMENT_METADATA.items()
]


class RagService:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _require_configuration(self) -> None:
        if not self.settings.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY is not configured")
        if not self.settings.database_configured:
            raise RuntimeError("DATABASE_URL is not configured")

    def database_ready(self) -> bool:
        return database_ready(self.settings)

    def _vector_store(self) -> PGVector:
        return PGVector(
            embeddings=create_embeddings(self.settings),
            collection_name=self.settings.pgvector_collection,
            connection=self.settings.database_url,
            use_jsonb=True,
        )

    def reindex(self) -> int:
        self._require_configuration()
        PGVector.from_documents(
            documents=KNOWLEDGE_BASE,
            embedding=create_embeddings(self.settings),
            collection_name=self.settings.pgvector_collection,
            connection=self.settings.database_url,
            pre_delete_collection=True,
            use_jsonb=True,
        )
        return len(KNOWLEDGE_BASE)

    def _fallback_search(self, query: str):
        query_terms = {term.lower() for term in query.split() if len(term) > 2}
        scored_documents = []
        for document in KNOWLEDGE_BASE:
            document_terms = set(document.page_content.lower().split())
            score = len(query_terms & document_terms)
            if score:
                scored_documents.append((score, document))
        scored_documents.sort(key=lambda item: item[0], reverse=True)
        return [document for _, document in scored_documents[:4]]

    def chat(self, request: ChatRequest) -> ChatResponse:
        self._require_configuration()
        session_id = request.session_id or str(uuid4())
        try:
            documents = self._vector_store().similarity_search(request.message, k=4)
        except Exception:
            documents = self._fallback_search(request.message)
        if not documents:
            answer = "I do not have enough verified information to answer that. Please call 1212 for assistance."
            save_chat_exchange(self.settings, session_id, request.message, answer, "low", [])
            return ChatResponse(
                session_id=session_id,
                answer=answer,
                sources=[],
                confidence="low",
            )

        context = "\n\n".join(document.page_content for document in documents)
        history = "\n".join(f"{turn.role}: {turn.content}" for turn in request.history)
        answer = generate_answer(self.settings, context, history, request.message)
        source_values: list[tuple[str, str]] = []
        for document in documents:
            source = (
                document.metadata.get("title", "SLT-MOBITEL information"),
                document.metadata.get("category", "general"),
            )
            if source not in source_values:
                source_values.append(source)
        sources = [Source(title=title, category=category) for title, category in source_values]
        confidence = "high" if len(documents) >= 2 else "medium"
        save_chat_exchange(
            self.settings,
            session_id,
            request.message,
            answer,
            confidence,
            [source.model_dump() for source in sources],
        )
        return ChatResponse(session_id=session_id, answer=answer, sources=sources, confidence=confidence)


@lru_cache
def get_rag_service() -> RagService:
    return RagService(get_settings())
