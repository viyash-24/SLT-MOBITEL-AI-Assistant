"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DailyCall, DailyTrackState, DailyEventObjectParticipantLeft,
  DailyEventObjectFatalError, DailyEventObjectCameraError,
} from "@daily-co/daily-js";

export type TavusSessionState = "idle" | "checking" | "not_configured" | "connecting" | "active" | "ending" | "error";

export type TavusStartOptions = {
  conversationalContext?: string;
  customGreeting?: string;
  conversationName?: string;
  language?: string;
};

export type UseTavusSessionResult = {
  tavusState: TavusSessionState;
  avatarStream: MediaStream | null;
  conversationUrl: string | null;
  conversationId: string | null;
  tavusError: string | null;
  isConfigured: boolean;
  isMuted: boolean;
  startTavusSession: (options?: TavusStartOptions) => Promise<void>;
  endTavusSession: () => Promise<void>;
  toggleMute: () => Promise<void>;
};

type Session = {
  cancelled: boolean;
  joined: boolean;
  conversationId: string | null;
  call: DailyCall | null;
  participantId: string | null;
  startup: Promise<void>;
  cancellation: Promise<void>;
  cancelStartup: () => void;
  termination?: Promise<void>;
  timeout?: ReturnType<typeof setTimeout>;
  removeListeners?: () => void;
};

function getApiBase(): string {
  const envApi = process.env.NEXT_PUBLIC_API_URL;
  if (envApi) return envApi.replace(/\/+$/, "");
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname || "127.0.0.1"}:8000`;
  return "http://127.0.0.1:8000";
}

async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  return new Error(typeof body.detail === "string" ? body.detail : `Avatar service error (${response.status}).`);
}

function playableTrack(track: DailyTrackState | undefined): MediaStreamTrack | null {
  if (track?.state !== "playable") return null;
  const media = track.persistentTrack ?? track.track;
  return media && media.readyState !== "ended" ? media : null;
}

/** Tavus owns recognition, reasoning, speech and facial animation. Daily only
 * transports that one assistant's media; the caller renders avatarStream in
 * one video element. There is no prebuilt room or independent voice player. */
export function useTavusSession(): UseTavusSessionResult {
  const [tavusState, setTavusState] = useState<TavusSessionState>("idle");
  const [avatarStream, setAvatarStream] = useState<MediaStream | null>(null);
  const [conversationUrl, setConversationUrl] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [tavusError, setTavusError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const mounted = useRef(false);
  const session = useRef<Session | null>(null);
  const pendingEndId = useRef<string | null>(null);

  const endRemoteConversation = useCallback(async (id: string) => {
    // Retain failures: a retry must end the old conversation before creating
    // another one, otherwise a network error can leave two billable sessions.
    pendingEndId.current = id;
    const response = await fetch(`${getApiBase()}/api/tavus/conversation/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: id }),
      keepalive: true,
    });
    if (!response.ok) throw await responseError(response);
    if (pendingEndId.current === id) pendingEndId.current = null;
  }, []);

  const terminate = useCallback((operation: Session, error?: string): Promise<void> => {
    if (operation.termination) return operation.termination;
    operation.cancelled = true;
    operation.cancelStartup();
    clearTimeout(operation.timeout);
    operation.removeListeners?.();
    if (mounted.current && session.current === operation) {
      setAvatarStream(null);
      setTavusState(error ? "error" : "ending");
      if (error) setTavusError(error);
    }
    operation.termination = (async () => {
      let cleanupError: string | null = null;
      // destroy() leaves the meeting and stops Daily's owned local media. Do
      // this immediately, even when joining is still pending.
      const call = operation.call;
      operation.call = null;
      if (call) {
        try { await call.destroy(); }
        catch { cleanupError = "Unable to finish disconnecting the avatar. Please reload the page."; }
      }
      // An aborted create request can orphan a billable conversation. Wait
      // for its ID and end it even if the user cancelled or navigated away.
      await operation.startup;
      if (operation.conversationId) {
        try {
          await endRemoteConversation(operation.conversationId);
        } catch (cause) {
          cleanupError = cause instanceof Error ? cause.message : "Could not confirm the avatar session ended.";
        }
      }
      if (session.current !== operation) return;
      session.current = null;
      if (!mounted.current) return;
      setConversationId(null);
      setConversationUrl(null);
      setIsMuted(false);
      setTavusState(error || cleanupError ? "error" : "idle");
      if (cleanupError) setTavusError([error, cleanupError].filter(Boolean).join(" "));
    })();
    return operation.termination;
  }, [endRemoteConversation]);

  const endTavusSession = useCallback(async () => {
    if (session.current) await terminate(session.current);
    else if (pendingEndId.current) {
      try {
        await endRemoteConversation(pendingEndId.current);
        if (mounted.current) { setTavusState("idle"); setTavusError(null); }
      } catch (cause) {
        if (mounted.current) setTavusError(cause instanceof Error ? cause.message : "Could not confirm the avatar session ended.");
      }
    }
  }, [terminate, endRemoteConversation]);

  const startTavusSession = useCallback(async (options: TavusStartOptions = {}) => {
    // A ref guard prevents duplicate starts in the same render. Retain it
    // through cleanup so retry cannot overlap a pending create or disconnect.
    if (session.current || !mounted.current) return;
    let cancelStartup = () => {};
    const cancellation = new Promise<void>((resolve) => { cancelStartup = resolve; });
    const operation: Session = {
      cancelled: false, joined: false, conversationId: null, call: null,
      participantId: null, startup: Promise.resolve(), cancellation, cancelStartup,
    };
    session.current = operation;
    setTavusError(null);
    setAvatarStream(null);
    setIsMuted(false);
    setTavusState("checking");

    operation.startup = (async () => {
      try {
        if (pendingEndId.current) await endRemoteConversation(pendingEndId.current);
        if (operation.cancelled) return;
        const statusResponse = await fetch(`${getApiBase()}/api/tavus/status`);
        if (operation.cancelled) return;
        if (!statusResponse.ok) throw await responseError(statusResponse);
        const status = await statusResponse.json();
        if (operation.cancelled) return;
        setIsConfigured(Boolean(status.configured));
        if (!status.configured) {
          setTavusState("not_configured");
          setTavusError(status.detail || "The live avatar is not configured. Please contact your administrator.");
          session.current = null;
          return;
        }
        setTavusState("connecting");
        const response = await fetch(`${getApiBase()}/api/tavus/conversation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversational_context: options.conversationalContext ?? "",
            custom_greeting: options.customGreeting ?? "Hello! I'm Kasuni, your SLT-MOBITEL AI assistant. How can I help you today?",
            conversation_name: options.conversationName ?? "SLT-MOBITEL AI Voice Session",
            language: options.language ?? "EN",
          }),
        });
        if (!response.ok) throw await responseError(response);
        const data = await response.json();
        operation.conversationId = typeof data.conversation_id === "string" ? data.conversation_id : null;
        if (operation.cancelled) return;
        if (!operation.conversationId || typeof data.conversation_url !== "string" || !data.conversation_url) {
          throw new Error("The avatar service did not return a valid conversation.");
        }
        setConversationId(operation.conversationId);
        setConversationUrl(data.conversation_url);
        // Browser-only import avoids evaluating Daily during server rendering.
        const { default: Daily } = await import("@daily-co/daily-js");
        if (operation.cancelled) return;
        const call = Daily.createCallObject({ audioSource: true, videoSource: false });
        operation.call = call;
        const fail = (message: string) => { if (!operation.cancelled) void terminate(operation, message); };
        const waitForAvatar = () => {
          if (operation.timeout) return;
          operation.timeout = setTimeout(() => {
            fail("Kasuni's live video and audio did not connect. Please try again.");
          }, 45_000);
        };
        const syncParticipants = () => {
          if (operation.cancelled || !mounted.current) return;
          const participants = call.participants();
          if (participants.local) setIsMuted(!participants.local.audio);
          const avatar = operation.participantId
            ? participants[operation.participantId]
            : Object.values(participants).find((participant) => !participant.local);
          if (avatar) operation.participantId = avatar.session_id;
          const video = playableTrack(avatar?.tracks.video);
          const audio = playableTrack(avatar?.tracks.audio);
          // Never play a voice without its live face, including during initial
          // subscription and a temporarily interrupted video track.
          const tracks = video && audio ? [video, audio] : [];
          setAvatarStream((current) => {
            if (!tracks.length) return null;
            const currentTracks = current?.getTracks();
            if (currentTracks?.length === tracks.length && tracks.every((track) => currentTracks.includes(track))) return current;
            return new MediaStream(tracks);
          });
          if (operation.joined && video && audio) {
            clearTimeout(operation.timeout);
            operation.timeout = undefined;
            setTavusState("active");
          } else {
            setTavusState("connecting");
            waitForAvatar();
          }
        };
        const onJoined = () => { operation.joined = true; syncParticipants(); };
        const onLeft = () => fail("The avatar conversation has ended. Start a new conversation to continue.");
        const onParticipantLeft = (event?: DailyEventObjectParticipantLeft) => {
          if (event?.participant.session_id === operation.participantId) onLeft();
          else syncParticipants();
        };
        const onError = (event?: DailyEventObjectFatalError) => fail(event?.errorMsg || "The avatar connection failed. Please try again.");
        const onCameraError = (event?: DailyEventObjectCameraError) => {
          if (!event?.errorMsg.audioOk) fail("Microphone access failed. Allow microphone access and try again.");
        };
        call.on("joined-meeting", onJoined);
        call.on("participant-joined", syncParticipants);
        call.on("participant-updated", syncParticipants);
        call.on("track-started", syncParticipants);
        call.on("track-stopped", syncParticipants);
        call.on("participant-left", onParticipantLeft);
        call.on("left-meeting", onLeft);
        call.on("error", onError);
        call.on("camera-error", onCameraError);
        operation.removeListeners = () => {
          call.off("joined-meeting", onJoined);
          call.off("participant-joined", syncParticipants);
          call.off("participant-updated", syncParticipants);
          call.off("track-started", syncParticipants);
          call.off("track-stopped", syncParticipants);
          call.off("participant-left", onParticipantLeft);
          call.off("left-meeting", onLeft);
          call.off("error", onError);
          call.off("camera-error", onCameraError);
        };
        waitForAvatar();
        await Promise.race([call.join({
          url: data.conversation_url,
          ...(typeof data.meeting_token === "string" && data.meeting_token ? { token: data.meeting_token } : {}),
          userName: "Customer", startVideoOff: true, startAudioOff: false,
        }), operation.cancellation]);
        if (operation.cancelled) return;
        operation.joined = true;
        syncParticipants();
      } catch (cause) {
        if (!operation.cancelled) {
          const message = cause instanceof Error ? cause.message : "Failed to connect to the live avatar.";
          // Termination waits for startup, so it must not be awaited here.
          void terminate(operation, message);
        }
      }
    })();
    await operation.startup;
  }, [terminate, endRemoteConversation]);

  const toggleMute = useCallback(async () => {
    const operation = session.current;
    const call = operation?.call;
    if (!call || !operation.joined || operation.cancelled) return;
    try {
      const enabled = Boolean(call.participants().local?.audio);
      await call.setLocalAudio(!enabled);
      if (!operation.cancelled && mounted.current) setIsMuted(!call.participants().local.audio);
    } catch {
      if (mounted.current) setTavusError("Could not change the microphone. Please try again.");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const onPageHide = () => { void endTavusSession(); };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", onPageHide);
      void endTavusSession();
    };
  }, [endTavusSession]);

  return {
    tavusState, avatarStream, conversationUrl, conversationId, tavusError,
    isConfigured, isMuted, startTavusSession, endTavusSession, toggleMute,
  };
}
