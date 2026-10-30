"""End-to-end API route tests for the Clean Architecture FastAPI app."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "database_ready" in data
    assert "knowledge_base_documents" in data


def test_chat_endpoint_valid_request():
    response = client.post(
        "/api/chat",
        json={
            "message": "What is SLT Fiber?",
            "history": [],
            "session_id": "test-session-123",
        },
    )
    # Status code will be 200 (if API key / DB / fallback works) or 502/503 handled gracefully
    assert response.status_code in (200, 502, 503)
    if response.status_code == 200:
        data = response.json()
        assert "answer" in data
        assert "session_id" in data
        assert "sources" in data


def test_chat_endpoint_empty_message_validation():
    # Message is required
    response = client.post("/api/chat", json={})
    assert response.status_code == 422


def test_livekit_token_endpoint():
    response = client.post("/api/livekit/token", json={"language": "EN"})
    # Either 200 (if keys set) or 503 (if missing credentials)
    assert response.status_code in (200, 503)
    if response.status_code == 200:
        data = response.json()
        assert "token" in data
        assert "url" in data
        assert "room" in data
        assert data["language"] == "EN"
