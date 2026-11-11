"""Voice route tests."""
import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestVoiceRoutes(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_voice_live_endpoint_connects_and_handshakes(self):
        with self.client.websocket_connect("/api/voice/live?session_id=test-session&language=EN") as socket:
            message = socket.receive_json()
            self.assertEqual(message["type"], "ready")
            self.assertEqual(message["inputSampleRate"], 16000)
            self.assertEqual(message["outputSampleRate"], 24000)

    def test_legacy_token_does_not_redirect_to_second_voice_pipeline(self):
        response = self.client.get("/api/livekit/token")
        self.assertEqual(response.status_code, 410)
        self.assertIn("LiveKit", response.json()["detail"])
        self.assertNotIn("token", response.json())


if __name__ == "__main__":
    unittest.main()
