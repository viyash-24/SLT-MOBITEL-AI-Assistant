# Single Tavus Avatar Voice Architecture

The voice page uses one Tavus CVI conversation. Tavus receives microphone input and produces the assistant's response, speech, facial movement, and synchronized lip movements. Daily's headless call object provides WebRTC transport; its hosted call interface is never embedded.

```text
Browser microphone → Daily call object → Tavus PAL (listening + reasoning + voice + face)
Browser <video>     ← one synchronized avatar audio/video stream ← Tavus
```

The backend creates and ends Tavus sessions with server-only credentials. A configured PAL is required; the application no longer selects an unrelated default persona. Its knowledge, voice, and face are configured in Tavus. The existing `/api/chat` RAG service remains available for text chat; it does not automatically feed Tavus.

## Lifecycle

- A click on Start creates one session, guarded synchronously against repeated clicks.
- The browser joins without a local camera and with microphone audio enabled.
- The UI waits for actual remote media before displaying Live.
- One video element plays both audio and video from the selected remote avatar participant.
- Mute changes the SDK microphone state. End, navigation, errors, and delayed create responses release the call and terminate the provider session.
- Configuration, credits, permission, join, and cleanup failures are reported. No separate speaking assistant or simulated face starts as a fallback.
- `/api/voice/live` rejects stale clients with an explanatory error. Legacy LiveKit requests return 410.

## Validation

Automated tests mock Tavus and Daily to check provider payloads, explicit configuration, credits/errors, session races, cleanup, actual media readiness, and microphone control. They do not prove provider voice quality or lip-sync.

Before deploying, run a live acceptance session with a configured Tavus PAL and credits:

1. Confirm only the avatar appears, with no hosted room/prejoin screen or local camera preview.
2. Ask one question; verify only one answer is audible and its lip movement follows the voice.
3. Mute and speak; verify microphone input is disabled. Unmute and ask again.
4. Interrupt a response and confirm the PAL's configured interruption behavior.
5. End during connection, retry, and navigate away; verify no microphone or billable session remains active.
6. Test English, Tamil, and Sinhala using appropriately configured voices (Sinhala requires a compatible custom TTS setup).
7. Ask a current package question and verify the configured PAL's SLT-MOBITEL knowledge matches the approved source.

Official references: [Tavus conversations](https://docs.tavus.io/api-reference/conversations/create-conversation), [Daily call object](https://docs.daily.co/reference/daily-js/factory-methods/create-call-object).
