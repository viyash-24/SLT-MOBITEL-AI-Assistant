"use client";

/**
 * useSimliAvatar — Simli real-time lip-sync avatar hook.
 *
 * Manages the full Simli session lifecycle:
 *   1. Fetches a short-lived session token from the backend (API key stays server-side).
 *   2. Initialises SimliClient with the DOM video/audio refs.
 *   3. Exposes sendAudio(chunk: Uint8Array) for 24 kHz PCM from Gemini Live.
 *      The hook resamples 24 kHz → 16 kHz (Simli requirement) before forwarding.
 *   4. Cleans up the WebRTC session on stop/unmount.
 *
 * Audio resampling: simple linear-interpolation decimation, factor = 24000/16000 = 1.5.
 * This matches the precision used by the existing AudioWorklet uplink resampler.
 *
 * SimliClient events (v3.x):
 *   start, stop, error, ack, speaking, silent, startup_error, warning, ...
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SimliClient } from "simli-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSimliTokenUrl(): string {
  const envApi = process.env.NEXT_PUBLIC_API_URL;
  if (envApi) return `${envApi}/api/simli/session-token`;
  if (typeof window !== "undefined") {
    const host = `${window.location.hostname || "127.0.0.1"}:8000`;
    return `http://${host}/api/simli/session-token`;
  }
  return "http://127.0.0.1:8000/api/simli/session-token";
}

/**
 * Resample 24 kHz 16-bit PCM → 16 kHz 16-bit PCM using linear interpolation.
 * Input:  Uint8Array of raw bytes (little-endian int16 samples, 24 000 Hz mono)
 * Output: Uint8Array of raw bytes (little-endian int16 samples, 16 000 Hz mono)
 */
function resample24to16(input: Uint8Array): Uint8Array {
  if (input.length < 2) return new Uint8Array(0);

  // Ensure 2-byte alignment
  const aligned = input.length % 2 === 0 ? input : input.subarray(0, input.length - 1);

  // View as Int16
  const int16In = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2);
  const inLen = int16In.length;
  if (inLen === 0) return new Uint8Array(0);

  // Output sample count: ratio = 16000/24000 = 2/3  → outLen ≈ inLen * 2/3
  const outLen = Math.floor((inLen * 2) / 3);
  if (outLen === 0) return new Uint8Array(0);

  const int16Out = new Int16Array(outLen);
  // step = 24000/16000 = 1.5 — advance 1.5 input samples per output sample
  const step = 1.5;
  let pos = 0;
  for (let i = 0; i < outLen; i++) {
    const floor = Math.floor(pos);
    const ceil = Math.min(floor + 1, inLen - 1);
    const frac = pos - floor;
    int16Out[i] = Math.round(int16In[floor] * (1 - frac) + int16In[ceil] * frac);
    pos += step;
  }

  return new Uint8Array(int16Out.buffer);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type SimliAvatarStatus =
  | "idle"
  | "fetching-token"
  | "connecting"
  | "connected"
  | "error"
  | "stopped";

export function useSimliAvatar() {
  const [status, setStatus] = useState<SimliAvatarStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<SimliClient | null>(null);
  const startedRef = useRef(false);
  const statusRef = useRef<SimliAvatarStatus>("idle");

  // PCM remainder from previous chunk (may be unaligned 1 byte)
  const remainderRef = useRef<Uint8Array | null>(null);

  // Keep statusRef in sync so sendAudio can read it without stale closure
  useEffect(() => { statusRef.current = status; }, [status]);

  // Cleanup helper
  const destroyClient = useCallback(() => {
    const client = clientRef.current;
    if (client) {
      try {
        client.stop().catch(() => { /* ignore */ });
      } catch {
        /* ignore */
      }
      clientRef.current = null;
    }
    remainderRef.current = null;
    startedRef.current = false;
  }, []);

  const stopAvatar = useCallback(() => {
    destroyClient();
    setStatus("stopped");
    statusRef.current = "stopped";
  }, [destroyClient]);

  const startAvatar = useCallback(async () => {
    if (startedRef.current) return; // already initialising / running
    if (!videoRef.current || !audioRef.current) {
      setErrorMsg("Avatar video/audio elements not mounted yet.");
      setStatus("error");
      statusRef.current = "error";
      return;
    }

    startedRef.current = true;
    setErrorMsg(null);
    setStatus("fetching-token");
    statusRef.current = "fetching-token";

    // 1. Fetch session token from backend (keeps API key server-side)
    let sessionToken: string;
    try {
      const res = await fetch(getSimliTokenUrl(), { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Backend returned ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = await res.json();
      sessionToken = json.session_token;
      if (!sessionToken) throw new Error("No session_token in backend response.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Simli] Token fetch failed:", msg);
      setErrorMsg(msg);
      setStatus("error");
      statusRef.current = "error";
      startedRef.current = false;
      return;
    }

    setStatus("connecting");
    statusRef.current = "connecting";

    // 2. Initialise SimliClient
    // Constructor: new SimliClient(session_token, videoElement, audioElement, iceServers, logLevel?)
    try {
      const client = new SimliClient(
        sessionToken,
        videoRef.current,
        audioRef.current,
        null  // let Simli handle ICE servers
      );
      clientRef.current = client;

      // "start" fires when WebRTC media is flowing and avatar is visible
      client.on("start", () => {
        console.log("[Simli] Avatar connected — lip-sync active.");
        setStatus("connected");
        statusRef.current = "connected";
      });

      // "stop" fires when session ends normally
      client.on("stop", () => {
        console.log("[Simli] Avatar session stopped.");
        if (startedRef.current) {
          setStatus("idle");
          statusRef.current = "idle";
          startedRef.current = false;
        }
      });

      // "error" fires on runtime errors
      client.on("error", (detail: string) => {
        console.error("[Simli] Runtime error:", detail);
        if (startedRef.current) {
          setErrorMsg(`Simli error: ${detail}`);
          setStatus("error");
          statusRef.current = "error";
          startedRef.current = false;
        }
      });

      // "startup_error" fires when session cannot be established at all
      client.on("startup_error", (detail: string) => {
        console.error("[Simli] Startup error:", detail);
        setErrorMsg(`Simli startup error: ${detail}`);
        setStatus("error");
        statusRef.current = "error";
        destroyClient();
      });

      await client.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Simli] Client start failed:", msg);
      setErrorMsg(msg);
      setStatus("error");
      statusRef.current = "error";
      destroyClient();
    }
  }, [destroyClient]);

  /**
   * Forward a raw 24 kHz PCM chunk from Gemini Live to Simli.
   * Called by useVoiceSession's onRawPcm24k callback in page.tsx.
   * Uses statusRef to avoid stale closure issues with the status state.
   */
  const sendAudio = useCallback((chunk24k: Uint8Array) => {
    const client = clientRef.current;
    if (!client || statusRef.current !== "connected") return;

    // Merge with any leftover byte from previous call
    let bytes = chunk24k;
    if (remainderRef.current && remainderRef.current.length > 0) {
      const merged = new Uint8Array(remainderRef.current.length + bytes.length);
      merged.set(remainderRef.current, 0);
      merged.set(bytes, remainderRef.current.length);
      bytes = merged;
      remainderRef.current = null;
    }

    // Keep trailing odd byte for next call
    if (bytes.length % 2 !== 0) {
      remainderRef.current = bytes.slice(bytes.length - 1);
      bytes = bytes.subarray(0, bytes.length - 1);
    }

    if (bytes.length < 2) return;

    const pcm16k = resample24to16(bytes);
    if (pcm16k.length > 0) {
      try {
        client.sendAudioData(pcm16k);
      } catch (err) {
        console.warn("[Simli] sendAudioData error:", err);
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyClient();
    };
  }, [destroyClient]);

  return {
    /** Ref to attach to <video> element */
    videoRef,
    /** Ref to attach to <audio> element */
    audioRef,
    /** Current avatar connection status */
    status,
    /** Error message if status === "error" */
    errorMsg,
    /** Call on voice session start to begin Simli connection */
    startAvatar,
    /** Call on voice session end / component unmount */
    stopAvatar,
    /** Forward raw 24 kHz PCM Uint8Array from Gemini; hook resamples to 16 kHz */
    sendAudio,
    /** True when Simli is fully connected and processing audio */
    isConnected: status === "connected",
  };
}
