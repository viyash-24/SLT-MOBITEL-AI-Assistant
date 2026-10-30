"""Shared AssistantService — the core application service.

This is the single entry point for both the text chatbot (via HTTP) and
the LiveKit voice agent.  It orchestrates:

  1. Input validation and session ID assignment.
  2. Knowledge-base retrieval via VectorStorePort.
  3. Context assembly and history formatting.
  4. Grounding policy check (fallback if no documents found).
  5. LLM answer generation via LLMPort.
  6. Persistence via ChatRepositoryPort.
  7. Response assembly with sources and confidence.

Dependencies (injected at construction time):
  - llm          : LLMPort — generates the answer.
  - vector_store : VectorStorePort — retrieves knowledge documents.
  - repository   : ChatRepositoryPort — persists exchanges.

Neither FastAPI, LangChain, LiveKit SDK, nor any provider SDK is imported
here.  The application layer depends only on:
  - domain models   (app.domain.models.chat)
  - domain policies (app.domain.policies.grounding_policy)
  - domain errors   (app.domain.exceptions.assistant_exceptions)
  - port protocols  (app.application.ports.*)
"""
from __future__ import annotations

import logging
from uuid import uuid4

from app.application.ports.chat_repository_port import ChatRepositoryPort
from app.application.ports.llm_port import LLMPort
from app.application.ports.vector_store_port import VectorStorePort
from app.domain.exceptions.assistant_exceptions import ConfigurationError, ProviderError
from app.domain.models.chat import AssistantRequest, AssistantResponse, SourceReference
from app.domain.policies import grounding_policy

logger = logging.getLogger(__name__)

_RETRIEVAL_K = 5          # Top-K documents retrieved per query
_HISTORY_MAX_TURNS = 10   # Limit history sent to LLM to control token usage


class AssistantService:
    """Shared AI answer-generation service used by both text and voice channels.

    Strategy pattern:
      The *channel* field on AssistantRequest acts as the strategy selector.
      Text channel: returns full AssistantResponse with sources + confidence.
      Voice channel: same code path, caller uses only the .answer field.
    """

    def __init__(
        self,
        llm: LLMPort,
        vector_store: VectorStorePort,
        repository: ChatRepositoryPort,
    ) -> None:
        self._llm = llm
        self._vector_store = vector_store
        self._repository = repository

    # ── Public API ──────────────────────────────────────────────────────────

    def answer(self, request: AssistantRequest) -> AssistantResponse:
        """Produce a grounded answer for the given request.

        Called by:
          - The text chat HTTP route (channel="text")
          - The LiveKit voice agent's knowledge tool (channel="voice")

        Both paths run the same retrieval → grounding → LLM → save pipeline.
        """
        session_id = request.session_id or str(uuid4())

        # ── Step 1: retrieve knowledge ───────────────────────────────────────
        documents = self._vector_store.search(request.message, k=_RETRIEVAL_K)

        # ── Step 2: grounding policy ─────────────────────────────────────────
        if grounding_policy.should_fallback(len(documents)):
            answer = grounding_policy.FALLBACK_ANSWER
            self._repository.save_exchange(session_id, request.message, answer, "low", [])
            return AssistantResponse(
                session_id=session_id,
                answer=answer,
                sources=[],
                confidence="low",
                is_fallback=True,
            )

        # ── Step 3: build context string ─────────────────────────────────────
        context = self._build_context(documents)

        # ── Step 4: format history (trim to avoid token overflow) ─────────────
        history_turns = request.history[-_HISTORY_MAX_TURNS:]
        history = "\n".join(f"{turn.role}: {turn.content}" for turn in history_turns)

        # ── Step 5: generate answer ───────────────────────────────────────────
        try:
            answer = self._llm.generate(context, history, request.message)
        except (ConfigurationError, ProviderError):
            raise
        except Exception as exc:
            logger.error("Unexpected LLM error: %s", exc, exc_info=True)
            raise ProviderError(f"LLM generation failed: {exc}") from exc

        # ── Step 6: collect sources ───────────────────────────────────────────
        sources = self._collect_sources(documents)
        confidence = grounding_policy.confidence_from_count(len(documents))

        # ── Step 7: persist ───────────────────────────────────────────────────
        self._repository.save_exchange(
            session_id,
            request.message,
            answer,
            confidence,
            [{"title": s.title, "category": s.category} for s in sources],
        )

        return AssistantResponse(
            session_id=session_id,
            answer=answer,
            sources=sources,
            confidence=confidence,  # type: ignore[arg-type]
            is_fallback=False,
        )

    def retrieve_context(self, query: str, k: int = 3) -> tuple[str, list[SourceReference]]:
        """Return formatted plain-text context string and source references.

        Called by the LiveKit voice agent tool. Returns both the formatted
        context for Gemini Live and the deduplicated source list for frontend
        event publishing in a single retrieval call.
        """
        documents = self._vector_store.search(query, k=k)
        if not documents:
            return (
                "No verified matching information was found in the SLT-MOBITEL "
                "knowledge base. Advise the customer to call the SLT helpline at 1212.",
                [],
            )
        return self._build_context(documents), self._collect_sources(documents)

    def retrieve_context_text(self, query: str, k: int = 3) -> str:
        """Return a plain-text context string for the voice agent's tool call.

        The voice agent passes this to Gemini Live's instructions so it can
        answer grounded in SLT-MOBITEL knowledge. Intentionally lightweight —
        no LLM call, no persistence — voice uses the existing Gemini Live
        session's LLM.
        """
        context_text, _ = self.retrieve_context(query, k=k)
        return context_text

    # ── Private helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _build_context(documents: list) -> str:
        """Assemble retrieved documents into a formatted context string."""
        blocks: list[str] = []
        for doc in documents:
            title = doc.metadata.get("title") or doc.metadata.get("source") or "Document"
            category = doc.metadata.get("category", "")
            header = f"[{title} | Category: {category}]" if category else f"[{title}]"
            blocks.append(f"{header}\n{doc.page_content}")
        return "\n\n---\n\n".join(blocks)

    @staticmethod
    def _collect_sources(documents: list) -> list[SourceReference]:
        """Deduplicate and collect SourceReference objects from documents."""
        seen: set[tuple[str, str]] = set()
        sources: list[SourceReference] = []
        for doc in documents:
            title = str(doc.metadata.get("title", "SLT-MOBITEL information"))
            category = str(doc.metadata.get("category", "General"))
            key = (title, category)
            if key not in seen:
                seen.add(key)
                sources.append(SourceReference(title=title, category=category))
        return sources
