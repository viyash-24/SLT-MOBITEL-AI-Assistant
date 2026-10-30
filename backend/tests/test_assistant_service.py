"""Tests for the shared AssistantService (domain + application layers).

These tests use fakes (not mocks) so they run without any external dependencies
(no database, no LLM API key, no vector store).  They verify that both the text
and voice channels use identical business logic through the shared service.

Run from the backend directory:
    pytest tests/test_assistant_service.py -v
"""
from __future__ import annotations

import pytest

from app.application.services.assistant_service import AssistantService
from app.domain.exceptions.assistant_exceptions import ProviderError
from app.domain.models.chat import AssistantRequest, AssistantResponse, ChatTurn
from app.domain.policies import grounding_policy


# ---------------------------------------------------------------------------
# Fakes (in-process test doubles — no real network/DB)
# ---------------------------------------------------------------------------

class FakeDocument:
    """Minimal document that satisfies the VectorStorePort contract."""
    def __init__(self, content: str, title: str = "Test Doc", category: str = "Test"):
        self.page_content = content
        self.metadata = {"title": title, "category": category, "source": "test"}


class FakeVectorStore:
    """Returns a fixed set of documents or raises to simulate failure."""
    def __init__(self, documents: list[FakeDocument] | None = None, raise_on_search: bool = False):
        self._docs = documents or []
        self._raise = raise_on_search

    def search(self, query: str, k: int = 5) -> list:
        if self._raise:
            return []   # VectorStorePort.search must not raise — return empty
        return self._docs[:k]


class FakeLLM:
    """Returns a fixed answer or raises ProviderError."""
    def __init__(self, answer: str = "Test answer.", raise_error: bool = False):
        self._answer = answer
        self._raise = raise_error

    def generate(self, context: str, history: str, message: str) -> str:
        if self._raise:
            raise ProviderError("LLM unavailable")
        return self._answer


class FakeChatRepository:
    """Records save_exchange calls."""
    def __init__(self):
        self.calls: list[dict] = []

    def save_exchange(self, session_id, user_message, assistant_message, confidence, sources):
        self.calls.append({
            "session_id": session_id,
            "user_message": user_message,
            "assistant_message": assistant_message,
            "confidence": confidence,
            "sources": sources,
        })
        return True


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def repo():
    return FakeChatRepository()


@pytest.fixture()
def docs():
    return [
        FakeDocument("Fiber 50 package: Rs. 1299/month, 100 GB data.", "Fiber 50", "Broadband"),
        FakeDocument("Fiber 100 package: Rs. 1999/month, 200 GB data.", "Fiber 100", "Broadband"),
    ]


@pytest.fixture()
def service_with_docs(docs, repo):
    return AssistantService(
        llm=FakeLLM("The Fiber 50 package costs Rs. 1299."),
        vector_store=FakeVectorStore(docs),
        repository=repo,
    )


@pytest.fixture()
def service_no_docs(repo):
    return AssistantService(
        llm=FakeLLM(),
        vector_store=FakeVectorStore([]),
        repository=repo,
    )


# ---------------------------------------------------------------------------
# Grounding policy tests (domain layer — no service needed)
# ---------------------------------------------------------------------------

class TestGroundingPolicy:
    def test_fallback_when_no_docs(self):
        assert grounding_policy.should_fallback(0) is True

    def test_no_fallback_when_docs_present(self):
        assert grounding_policy.should_fallback(1) is False
        assert grounding_policy.should_fallback(5) is False

    def test_confidence_low_for_zero(self):
        assert grounding_policy.confidence_from_count(0) == "low"

    def test_confidence_medium_for_one(self):
        assert grounding_policy.confidence_from_count(1) == "medium"

    def test_confidence_high_for_two_plus(self):
        assert grounding_policy.confidence_from_count(2) == "high"
        assert grounding_policy.confidence_from_count(10) == "high"

    def test_fallback_answer_contains_helpline(self):
        assert "1212" in grounding_policy.FALLBACK_ANSWER


# ---------------------------------------------------------------------------
# AssistantService — happy path (text channel)
# ---------------------------------------------------------------------------

class TestAssistantServiceTextChannel:
    def test_returns_assistant_response(self, service_with_docs):
        req = AssistantRequest(message="What is the Fiber 50 package?")
        result = service_with_docs.answer(req)
        assert isinstance(result, AssistantResponse)

    def test_assigns_session_id_when_none(self, service_with_docs):
        req = AssistantRequest(message="test", session_id=None)
        result = service_with_docs.answer(req)
        assert result.session_id
        assert len(result.session_id) > 0

    def test_preserves_provided_session_id(self, service_with_docs):
        req = AssistantRequest(message="test", session_id="my-session-123")
        result = service_with_docs.answer(req)
        assert result.session_id == "my-session-123"

    def test_answer_from_llm(self, service_with_docs):
        req = AssistantRequest(message="What is the Fiber 50 package?")
        result = service_with_docs.answer(req)
        assert "Rs. 1299" in result.answer

    def test_high_confidence_with_two_docs(self, service_with_docs):
        req = AssistantRequest(message="fiber packages")
        result = service_with_docs.answer(req)
        assert result.confidence == "high"

    def test_sources_collected(self, service_with_docs):
        req = AssistantRequest(message="fiber packages")
        result = service_with_docs.answer(req)
        assert len(result.sources) == 2
        titles = {s.title for s in result.sources}
        assert "Fiber 50" in titles
        assert "Fiber 100" in titles

    def test_exchange_persisted(self, service_with_docs, repo):
        req = AssistantRequest(message="tell me about fiber", session_id="s-1")
        service_with_docs.answer(req)
        assert len(repo.calls) == 1
        call = repo.calls[0]
        assert call["session_id"] == "s-1"
        assert call["user_message"] == "tell me about fiber"
        assert call["confidence"] == "high"

    def test_is_not_fallback(self, service_with_docs):
        req = AssistantRequest(message="fiber packages")
        result = service_with_docs.answer(req)
        assert result.is_fallback is False


# ---------------------------------------------------------------------------
# AssistantService — fallback path (no retrieved documents)
# ---------------------------------------------------------------------------

class TestAssistantServiceFallback:
    def test_returns_fallback_answer(self, service_no_docs):
        req = AssistantRequest(message="unknown topic xyz")
        result = service_no_docs.answer(req)
        assert "1212" in result.answer

    def test_fallback_confidence_is_low(self, service_no_docs):
        req = AssistantRequest(message="unknown")
        result = service_no_docs.answer(req)
        assert result.confidence == "low"

    def test_fallback_sources_empty(self, service_no_docs):
        req = AssistantRequest(message="unknown")
        result = service_no_docs.answer(req)
        assert result.sources == []

    def test_is_fallback_flag_set(self, service_no_docs):
        req = AssistantRequest(message="unknown")
        result = service_no_docs.answer(req)
        assert result.is_fallback is True

    def test_fallback_persisted(self, service_no_docs, repo):
        req = AssistantRequest(message="unknown", session_id="sess-fallback")
        service_no_docs.answer(req)
        assert repo.calls[0]["confidence"] == "low"


# ---------------------------------------------------------------------------
# AssistantService — voice channel strategy
# ---------------------------------------------------------------------------

class TestAssistantServiceVoiceChannel:
    def test_voice_channel_uses_same_retrieval(self, docs, repo):
        """Voice channel must go through the same service code as text."""
        service = AssistantService(
            llm=FakeLLM("answer"),
            vector_store=FakeVectorStore(docs),
            repository=repo,
        )
        text_req = AssistantRequest(message="fiber", channel="text")
        voice_req = AssistantRequest(message="fiber", channel="voice")
        text_result = service.answer(text_req)
        voice_result = service.answer(voice_req)
        # Both channels must get the same answer from the same LLM
        assert text_result.answer == voice_result.answer

    def test_retrieve_context_text_returns_string(self, docs, repo):
        service = AssistantService(
            llm=FakeLLM(),
            vector_store=FakeVectorStore(docs),
            repository=repo,
        )
        context = service.retrieve_context_text("fiber packages")
        assert isinstance(context, str)
        assert "Fiber 50" in context

    def test_retrieve_context_returns_text_and_sources(self, docs, repo):
        service = AssistantService(
            llm=FakeLLM(),
            vector_store=FakeVectorStore(docs),
            repository=repo,
        )
        context, sources = service.retrieve_context("fiber packages")
        assert isinstance(context, str)
        assert "Fiber 50" in context
        assert len(sources) == 2
        assert sources[0].title == "Fiber 50"

    def test_retrieve_context_fallback_when_no_docs(self, repo):
        service = AssistantService(
            llm=FakeLLM(),
            vector_store=FakeVectorStore([]),
            repository=repo,
        )
        context, sources = service.retrieve_context("unknown")
        assert "1212" in context
        assert sources == []

    def test_retrieve_context_text_fallback_when_no_docs(self, repo):
        service = AssistantService(
            llm=FakeLLM(),
            vector_store=FakeVectorStore([]),
            repository=repo,
        )
        context = service.retrieve_context_text("unknown")
        assert "1212" in context


# ---------------------------------------------------------------------------
# AssistantService — LLM failure handling
# ---------------------------------------------------------------------------

class TestAssistantServiceLLMFailure:
    def test_provider_error_propagates(self, docs, repo):
        service = AssistantService(
            llm=FakeLLM(raise_error=True),
            vector_store=FakeVectorStore(docs),
            repository=repo,
        )
        with pytest.raises(ProviderError):
            service.answer(AssistantRequest(message="fiber"))

    def test_exchange_not_persisted_on_llm_failure(self, docs, repo):
        service = AssistantService(
            llm=FakeLLM(raise_error=True),
            vector_store=FakeVectorStore(docs),
            repository=repo,
        )
        with pytest.raises(ProviderError):
            service.answer(AssistantRequest(message="fiber"))
        assert len(repo.calls) == 0


# ---------------------------------------------------------------------------
# AssistantService — conversation history
# ---------------------------------------------------------------------------

class TestAssistantServiceHistory:
    def test_history_included_in_context(self, docs, repo):
        """Verify that history is passed through to LLM (captured as context string)."""
        captured: list[str] = []

        class CapturingLLM:
            def generate(self, context, history, message):
                captured.append(history)
                return "OK"

        service = AssistantService(
            llm=CapturingLLM(),
            vector_store=FakeVectorStore(docs),
            repository=repo,
        )
        req = AssistantRequest(
            message="tell me more",
            history=[
                ChatTurn(role="user", content="what is fiber?"),
                ChatTurn(role="assistant", content="Fiber is a broadband service."),
            ],
        )
        service.answer(req)
        assert "what is fiber?" in captured[0]
        assert "Fiber is a broadband service." in captured[0]
