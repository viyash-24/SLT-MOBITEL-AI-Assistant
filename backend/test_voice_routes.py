"""Stale clients must never start an independent audio assistant."""
import unittest

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app


class TestVoiceRoutes(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_legacy_audio_socket_explains_upgrade_then_closes(self):
        with self.client.websocket_connect("/api/voice/live") as socket:
            message = socket.receive_json()
            self.assertEqual(message["type"], "error")
            self.assertIn("Tavus", message["message"])
            with self.assertRaises(WebSocketDisconnect) as closed:
                socket.receive_json()
            self.assertEqual(closed.exception.code, 1008)

    def test_legacy_token_does_not_redirect_to_second_voice_pipeline(self):
        response = self.client.get("/api/livekit/token")
        self.assertEqual(response.status_code, 410)
        self.assertIn("Tavus", response.json()["detail"])
        self.assertNotIn("token", response.json())


if __name__ == "__main__":
    unittest.main()
