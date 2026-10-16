/**
 * LiveKit client service — token fetch and URL/token validation.
 *
 * Extracted from useLiveVoiceSession.ts so the hook contains only
 * React state management, not API communication logic.
 */

export type LiveKitTokenResponse = {
  token: string;
  url: string;
  room: string;
  language: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Request a LiveKit JWT token from the backend.
 * Throws a descriptive Error on any failure so the hook can
 * set a user-visible error message.
 */
export async function fetchLiveKitToken(language = "EN"): Promise<LiveKitTokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/livekit/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    });
  } catch {
    throw new Error("Unable to reach the voice service. Check that the backend is running.");
  }

  const payload = (await response.json().catch(() => null)) as
    | LiveKitTokenResponse
    | { detail?: string }
    | null;

  if (!response.ok || !payload || !("token" in payload)) {
    throw new Error(
      (payload && "detail" in payload && payload.detail) ||
        "LiveKit token service is unavailable."
    );
  }

  return payload as LiveKitTokenResponse;
}

/** Validate URL and token format before connecting to LiveKit. */
export function validateLiveKitCredentials(url: string, token: string): void {
  if (!url.startsWith("wss://") && !url.startsWith("ws://")) {
    throw new Error("The backend returned an invalid LiveKit URL.");
  }
  if (token.split(".").length !== 3) {
    throw new Error("The backend returned an invalid LiveKit token.");
  }
}
