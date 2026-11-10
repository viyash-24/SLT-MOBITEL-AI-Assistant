# SLT-MOBITEL AI Assistant Frontend

Next.js application with text chat, persistent recent chats, language selection, themes, and a Tavus live avatar.

## Run locally

Use Node.js 22 or newer (including the test tooling), and start the [backend](../backend/README.md) on port 8000.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. For a different backend address, set `NEXT_PUBLIC_API_URL` in `.env.local` before starting or building the app:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Voice

1. Open `/voice`, choose a language, and click **Start voice chat**.
2. Allow microphone access. The camera remains off.
3. Speak to SLT Avatar once the live avatar is ready. Tavus handles listening, reasoning, speech, facial movement, and lip-sync.
4. Use **Mute** or **Stop voice chat** to control the session. Only the assistant's animated portrait is displayed; there is no user camera preview or video-call screen.

`useTavusSession` creates one conversation through the backend, joins its URL with `@daily-co/daily-js`'s call object, and exposes the avatar's remote audio/video stream. `TavusAvatarView` renders that stream in a single video element. There is no prebuilt room UI, independent PCM audio player, browser speech synthesis, or canvas avatar fallback.

Session creation is initiated by a user click, guarded against duplicate starts, and cleaned up when canceled or unmounted, including late API responses. The UI becomes live only after joining and receiving the avatar's audio/video tracks. Language is chosen before starting, and microphone controls use the SDK's real local-audio state. If autoplay is blocked, click **Enable avatar audio and video**.

Configure Tavus credentials, PAL knowledge, supported languages, and credits on the backend/Tavus account. Provider failures remain visible; a different assistant never takes over silently. Voice requires HTTPS or localhost and a WebRTC-capable browser.

## Checks

```sh
npm test
npm run lint
npm run build
```

The hook tests mock the media SDK and backend to verify lifecycle races, media readiness, microphone control, and error handling without creating paid conversations. A live Tavus account is required to verify the actual generated face, voice quality, and lip-sync.
