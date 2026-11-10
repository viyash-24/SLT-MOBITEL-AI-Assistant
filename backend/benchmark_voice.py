import sys
import time

sys.path.insert(0, "backend")
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _receive_event(ws):
    message = ws.receive()
    if message.get("bytes"):
        return {"type": "audio", "bytes": message["bytes"]}
    text = message.get("text")
    if text:
        import json
        payload = json.loads(text)
        return payload
    return {"type": "unknown", "raw": message}


print("=== BENCHMARKING GEMINI LIVE API REAL-TIME VOICE ===", flush=True)

t0 = time.perf_counter()
with client.websocket_connect("/api/voice/live?session_id=perf-session-greeting") as ws:
    ready = _receive_event(ws)
    t_ready = time.perf_counter()
    connect_time_ms = (t_ready - t0) * 1000
    print(f"1. Connection Startup Latency: {connect_time_ms:.1f} ms", flush=True)
    print(f"   Active Model: {ready.get('model')}", flush=True)

    print("\n2. Receiving Initial Spoken Greeting from Assistant...", flush=True)
    greeting_ttfa = None
    greeting_text = ""
    greeting_chunks = 0
    t_greet_start = time.perf_counter()

    while True:
        msg = _receive_event(ws)
        now = time.perf_counter()
        mtype = msg.get("type")

        if mtype == "audio":
            greeting_chunks += 1
            if greeting_ttfa is None:
                greeting_ttfa = (now - t_greet_start) * 1000
                print(f"   - Greeting TTFA: {greeting_ttfa:.1f} ms", flush=True)

        elif mtype == "transcript" and msg.get("role") == "assistant":
            greeting_text = msg.get("text", "")

        elif mtype == "turn_complete":
            greet_total_ms = (now - t_greet_start) * 1000
            print(f"   - Greeting Completed in: {greet_total_ms:.1f} ms ({greeting_chunks} chunks)", flush=True)
            print(f'   - Greeting Text: "{greeting_text}"', flush=True)
            break

        elif mtype == "error":
            raise RuntimeError(msg.get("message", "unknown voice error"))

    print('\n3. Testing RAG Grounded Speech Turn ("What are the FTTH broadband packages?")...', flush=True)
    t_rag_send = time.perf_counter()
    ws.send_json({"type": "text", "text": "What are the FTTH broadband packages?"})

    rag_ttfa_ms = None
    rag_tool_time_ms = None
    rag_sources_time_ms = None
    rag_chunks = 0
    rag_transcript = ""
    sources_count = 0

    while True:
        msg = _receive_event(ws)
        now = time.perf_counter()
        mtype = msg.get("type")

        if mtype == "status" and msg.get("state") == "thinking":
            rag_tool_time_ms = (now - t_rag_send) * 1000
            print(f"   - RAG Tool Triggered at: {rag_tool_time_ms:.1f} ms ({msg.get('detail')})", flush=True)

        elif mtype == "sources":
            rag_sources_time_ms = (now - t_rag_send) * 1000
            sources_count = len(msg.get("sources", []))
            print(f"   - Knowledge Retrieved at: {rag_sources_time_ms:.1f} ms ({sources_count} citations)", flush=True)

        elif mtype == "audio":
            rag_chunks += 1
            if rag_ttfa_ms is None:
                rag_ttfa_ms = (now - t_rag_send) * 1000
                print(f"   - Grounded TTFA: {rag_ttfa_ms:.1f} ms", flush=True)

        elif mtype == "transcript" and msg.get("role") == "assistant":
            rag_transcript = msg.get("text", "")
        elif mtype == "transcript" and msg.get("role") == "user":
            print(f"   - User transcript: {msg.get('text')}", flush=True)

        elif mtype == "turn_complete":
            rag_total_ms = (now - t_rag_send) * 1000
            print(f"   - Grounded Turn Completed in: {rag_total_ms:.1f} ms ({rag_chunks} chunks)", flush=True)
            print(f'   - Spoken Response: "{rag_transcript}"', flush=True)
            break

        elif mtype == "error":
            raise RuntimeError(msg.get("message", "unknown voice error"))

    ws.send_json({"type": "end"})

print("\n=== BENCHMARK COMPLETED SUCCESSFULLY ===", flush=True)
