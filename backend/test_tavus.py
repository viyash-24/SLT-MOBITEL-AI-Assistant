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
        self.assertIn("TAVUS_API_KEY", data["detail"])
        self.assertIn("TAVUS_PAL_ID", data["detail"])

    def test_status_configured(self):
        resp = self.client_configured.get("/api/tavus/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["configured"])
        self.assertTrue(data["has_pal"])
        self.assertIsNone(data["detail"])

    def test_api_key_without_pal_is_not_configured(self):
        app = FastAPI()
        app.include_router(tavus_router(Settings(tavus_api_key="key", tavus_pal_id="")))
        client = TestClient(app)
        self.assertFalse(client.get("/api/tavus/status").json()["configured"])
        self.assertEqual(client.post("/api/tavus/conversation", json={}).status_code, 503)

    def test_create_conversation_unconfigured(self):
        resp = self.client_unconfigured.post("/api/tavus/conversation", json={})
        self.assertEqual(resp.status_code, 503)
        self.assertIn("not configured", resp.json()["detail"])

    @patch("app.api.routes.tavus._post_to_tavus")
    def test_create_conversation_success(self, mock_post):
        mock_post.return_value = httpx.Response(
            200,
            json={
                "conversation_id": "c123456789",
                "conversation_url": "https://tavus.daily.co/c123456789",
                "status": "active",
                "meeting_token": "private-room-token",
            },
        )

        resp = self.client_configured.post(
            "/api/tavus/conversation",
            json={
                "custom_greeting": "Ayubowan! How can I help you?",
                "conversational_context": "User inquiring about fiber.",
                "language": "TA",
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["conversation_id"], "c123456789")
        self.assertEqual(data["conversation_url"], "https://tavus.daily.co/c123456789")
        self.assertEqual(data["status"], "active")
        self.assertEqual(data["meeting_token"], "private-room-token")

        # Verify payload sent to Tavus
        mock_post.assert_called_once()
        call_args = mock_post.call_args
        self.assertIn("headers", call_args.kwargs)
        self.assertEqual(call_args.kwargs["headers"]["x-api-key"], "test_tavus_key_123")
        payload = call_args.kwargs["json"]
        self.assertEqual(payload["pal_id"], "test_pal_456")
        self.assertEqual(payload["face_id"], "test_replica_789")
        self.assertEqual(payload["custom_greeting"], "Ayubowan! How can I help you?")
        self.assertEqual(payload["properties"]["languages"], ["ta"])
        self.assertTrue(payload["properties"]["enable_closed_captions"])
        self.assertFalse(payload["audio_only"])
        self.assertIn("verified SLT-MOBITEL knowledge", payload["conversational_context"])
        self.assertIn("User inquiring about fiber.", payload["conversational_context"])

    @patch("app.api.routes.tavus._post_to_tavus")
    def test_pal_default_face_is_not_overridden(self, mock_post):
        mock_post.return_value = httpx.Response(200, json={
            "conversation_id": "c123", "conversation_url": "https://tavus.daily.co/c123",
        })
        app = FastAPI()
        app.include_router(tavus_router(Settings(
            tavus_api_key="key", tavus_pal_id="application-pal", tavus_replica_id="",
        )))
        resp = TestClient(app).post("/api/tavus/conversation", json={})
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("face_id", mock_post.call_args.kwargs["json"])

    @patch("app.api.routes.tavus._post_to_tavus")
    def test_provider_response_requires_cleanup_id_and_sdk_url(self, mock_post):
        for body in [
            {"conversation_url": "https://tavus.daily.co/c123"},
            {"conversation_id": "c123"},
            {"conversation_id": "c123", "conversation_url": "javascript:bad"},
            [],
        ]:
            with self.subTest(body=body):
                mock_post.return_value = httpx.Response(200, json=body)
                self.assertEqual(self.client_configured.post("/api/tavus/conversation", json={}).status_code, 502)

    @patch("app.api.routes.tavus._post_to_tavus")
    def test_out_of_credits_is_not_hidden(self, mock_post):
        mock_post.return_value = httpx.Response(402, json={"error": "Out of credits"})
        resp = self.client_configured.post("/api/tavus/conversation", json={})
        self.assertEqual(resp.status_code, 402)
        self.assertIn("credits", resp.json()["detail"])

    @patch("app.api.routes.tavus._post_to_tavus")
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

    @patch("app.api.routes.tavus._post_to_tavus")
    def test_create_conversation_network_error(self, mock_post):
        mock_post.side_effect = httpx.ConnectError("Connection refused")

        resp = self.client_configured.post(
            "/api/tavus/conversation",
            json={},
        )
        self.assertEqual(resp.status_code, 502)
        self.assertIn("Unable to reach Tavus API", resp.json()["detail"])

    @patch("app.api.routes.tavus._post_to_tavus")
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

    @patch("app.api.routes.tavus._post_to_tavus")
    def test_end_failure_is_retryable(self, mock_post):
        mock_post.return_value = httpx.Response(500, json={"error": "failed"})
        resp = self.client_configured.post("/api/tavus/conversation/end", json={"conversation_id": "c123"})
        self.assertEqual(resp.status_code, 502)
        self.assertIn("retry", resp.json()["detail"])

    @patch("app.api.routes.tavus._post_to_tavus")
    def test_end_already_gone_is_success(self, mock_post):
        mock_post.return_value = httpx.Response(404, json={})
        resp = self.client_configured.post("/api/tavus/conversation/end", json={"conversation_id": "c123"})
        self.assertEqual(resp.status_code, 200)

    @patch("app.api.routes.tavus._post_to_tavus")
    def test_end_rejects_path_manipulation(self, mock_post):
        resp = self.client_configured.post("/api/tavus/conversation/end", json={"conversation_id": "../other"})
        self.assertEqual(resp.status_code, 400)
        mock_post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
