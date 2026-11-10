"""Unit and integration tests for Tavus CVI routes."""
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.api.routes.tavus import tavus_router
from config import Settings


class TestTavusRoutes(unittest.TestCase):
    def setUp(self):
        self.settings_unconfigured = Settings(
            tavus_api_key="",
            tavus_pal_id="",
            tavus_replica_id="",
        )
        self.settings_configured = Settings(
            tavus_api_key="test_tavus_key_123",
            tavus_pal_id="test_pal_456",
            tavus_replica_id="test_replica_789",
        )

        app_unconfigured = FastAPI()
        app_unconfigured.include_router(tavus_router(self.settings_unconfigured))
        self.client_unconfigured = TestClient(app_unconfigured)

        app_configured = FastAPI()
        app_configured.include_router(tavus_router(self.settings_configured))
        self.client_configured = TestClient(app_configured)

    def test_status_unconfigured(self):
        resp = self.client_unconfigured.get("/api/tavus/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertFalse(data["configured"])
        self.assertFalse(data["has_pal"])

    def test_status_configured(self):
        resp = self.client_configured.get("/api/tavus/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["configured"])
        self.assertTrue(data["has_pal"])

    def test_create_conversation_unconfigured(self):
        resp = self.client_unconfigured.post("/api/tavus/conversation", json={})
        self.assertEqual(resp.status_code, 503)
        self.assertIn("not configured", resp.json()["detail"])

    @patch("httpx.Client.post")
    def test_create_conversation_success(self, mock_post):
        mock_post.return_value = httpx.Response(
            200,
            json={
                "conversation_id": "c123456789",
                "conversation_url": "https://tavus.daily.co/c123456789",
                "status": "active",
            },
        )

        resp = self.client_configured.post(
            "/api/tavus/conversation",
            json={
                "custom_greeting": "Ayubowan! How can I help you?",
                "conversational_context": "User inquiring about fiber.",
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["conversation_id"], "c123456789")
        self.assertEqual(data["conversation_url"], "https://tavus.daily.co/c123456789")
        self.assertEqual(data["status"], "active")

        # Verify payload sent to Tavus
        mock_post.assert_called_once()
        call_args = mock_post.call_args
        self.assertIn("headers", call_args.kwargs)
        self.assertEqual(call_args.kwargs["headers"]["x-api-key"], "test_tavus_key_123")
        payload = call_args.kwargs["json"]
        self.assertEqual(payload["persona_id"], "test_pal_456")
        self.assertEqual(payload["replica_id"], "test_replica_789")
        self.assertEqual(payload["custom_greeting"], "Ayubowan! How can I help you?")

    @patch("httpx.Client.post")
    def test_create_conversation_tavus_error(self, mock_post):
        mock_post.return_value = httpx.Response(
            400,
            json={"error": "Invalid pal_id"},
        )

        resp = self.client_configured.post(
            "/api/tavus/conversation",
            json={},
        )
        self.assertEqual(resp.status_code, 502)
        self.assertIn("Tavus API error", resp.json()["detail"])

    @patch("httpx.Client.post")
    def test_create_conversation_network_error(self, mock_post):
        mock_post.side_effect = httpx.ConnectError("Connection refused")

        resp = self.client_configured.post(
            "/api/tavus/conversation",
            json={},
        )
        self.assertEqual(resp.status_code, 502)
        self.assertIn("Unable to reach Tavus API", resp.json()["detail"])

    @patch("httpx.Client.post")
    def test_end_conversation_success(self, mock_post):
        mock_post.return_value = httpx.Response(200, json={"status": "ended"})

        resp = self.client_configured.post(
            "/api/tavus/conversation/end",
            json={"conversation_id": "c123456789"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ended")
        self.assertEqual(data["conversation_id"], "c123456789")

        mock_post.assert_called_once()
        call_args = mock_post.call_args
        self.assertIn("c123456789/end", call_args.args[0])
        self.assertEqual(call_args.kwargs["headers"]["x-api-key"], "test_tavus_key_123")

    def test_end_conversation_empty_id(self):
        resp = self.client_configured.post(
            "/api/tavus/conversation/end",
            json={"conversation_id": ""},
        )
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
