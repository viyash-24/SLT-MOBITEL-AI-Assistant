"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionState, RemoteAudioTrack, Room, RoomEvent, Track } from "livekit-client";

export type AvatarState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type LiveVoiceSource = { title: string; category: string };

type LiveKitTokenResponse = {
  token: string;
  url: string;
  room: string;
  language: string;
};

type VoiceDataEvent =
  | { type: "state"; state: AvatarState | "initializing" | "idle" }
  | { type: "transcript"; role: "user" | "assistant"; text: string; final: string }
  | { type: "source"; title: string; category: string };

export type UseLiveVoiceSessionOptions = { language?: string };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function useLiveVoiceSession({ language = "EN" }: UseLiveVoiceSessionOptions = {}) {
  const [state, setState] = useState<AvatarState>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready to connect");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [sources, setSources] = useState<LiveVoiceSource[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<HTMLAudioElement[]>([]);
  const intentionalCloseRef = useRef(false);
  const stateRef = useRef<AvatarState>("idle");
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const analyserRef = useRef<{
    context: AudioContext;
    analyser: AnalyserNode;
    source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode;
    element: HTMLAudioElement;
    frame: number;
  } | null>(null);

  const setAvatarState = useCallback((next: AvatarState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const stopAudioMonitor = useCallback(() => {
    const monitor = analyserRef.current;
    if (!monitor) return;
    cancelAnimationFrame(monitor.frame);
    monitor.source.disconnect();
    monitor.analyser.disconnect();
    void monitor.context.close();
    analyserRef.current = null;
  }, []);

  const cleanup = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    audioElementsRef.current.forEach((element) => {
      element.pause();
      element.srcObject = null;
      element.remove();
    });
    audioElementsRef.current = [];
    if (room) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      room.disconnect();
    }
    stopAudioMonitor();
    setAudioLevel(0);
  }, [stopAudioMonitor]);

  const monitorAudio = useCallback((element: HTMLAudioElement, audioTrack?: RemoteAudioTrack) => {
    if (analyserRef.current) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioCtx();
      const analyser = context.createAnalyser();
      // 512 gives ~43 Hz per bin at 22 050 Hz nyquist
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7; // built-in temporal smoothing from Web Audio API

      let source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode;

      // Prefer MediaStreamSource directly from WebRTC track to prevent double-speaker playback
      // and bypass browser MediaElement silence issues.
      if (audioTrack?.mediaStreamTrack) {
        const stream = new MediaStream([audioTrack.mediaStreamTrack]);
        source = context.createMediaStreamSource(stream);
      } else {
        source = context.createMediaElementSource(element);
        analyser.connect(context.destination);
      }

      source.connect(analyser);
      const binCount = analyser.frequencyBinCount; // 256
      const freqData = new Uint8Array(binCount);

      // Determine speech-band bin range (~80 Hz – 3 500 Hz).
      const sampleRate = context.sampleRate || 48000;
      const hzPerBin = sampleRate / analyser.fftSize;
      const lowestBin = Math.max(1, Math.round(80 / hzPerBin));
      const highestBin = Math.min(binCount - 1, Math.round(3500 / hzPerBin));
      const speechBinCount = highestBin - lowestBin + 1;

      let lastUiUpdate = 0;
      const sample = () => {
        analyser.getByteFrequencyData(freqData);

        // Average energy over speech frequency band
        let sum = 0;
        for (let i = lowestBin; i <= highestBin; i++) {
          sum += freqData[i];
        }
        const avgEnergy = sum / (speechBinCount * 255); // 0..1

        const now = performance.now();
        if (now - lastUiUpdate >= 25) {
          lastUiUpdate = now;
          // Blend: 55% previous + 45% new → responsive and smooth lip sync level
          setAudioLevel((current) => Math.min(1, current * 0.55 + avgEnergy * 3.0 * 0.45));
        }
        if (analyserRef.current) {
          analyserRef.current.frame = requestAnimationFrame(sample);
        }
      };
      analyserRef.current = { context, analyser, source, element, frame: requestAnimationFrame(sample) };
      if (context.state === "suspended") {
        void context.resume();
      }
    } catch {
      setErrorMessage("Live audio analysis is unavailable; voice playback will continue without lip sync.");
    }
  }, []);

  const startSession = useCallback(async () => {
    if (startingRef.current || roomRef.current) return;
    startingRef.current = true;
    const generation = ++generationRef.current;
    intentionalCloseRef.current = false;
    await cleanup();
    setErrorMessage(null);
    setAssistantTranscript("");
    setSources([]);
    setAvatarState("connecting");
    setStatusMessage("Connecting to LiveKit...");

    try {
      const response = await fetch(`${apiUrl}/api/livekit/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const payload = (await response.json().catch(() => null)) as
        | LiveKitTokenResponse
        | { detail?: string }
        | null;
      if (!response.ok || !payload || !("token" in payload)) {
        throw new Error((payload && "detail" in payload && payload.detail) || "LiveKit token service is unavailable.");
      }
      const livekitUrl = payload.url.trim();
      const livekitToken = payload.token.trim();
      if (!livekitUrl.startsWith("wss://") && !livekitUrl.startsWith("ws://")) {
        throw new Error("The backend returned an invalid LiveKit URL.");
      }
      if (livekitToken.split(".").length !== 3) {
        throw new Error("The backend returned an invalid LiveKit token.");
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room.on(RoomEvent.ConnectionStateChanged, (connectionState) => {
        if (connectionState === ConnectionState.Reconnecting) {
          setAvatarState("connecting");
          setStatusMessage("Reconnecting to the voice service...");
        }
        if (connectionState === ConnectionState.Disconnected && !intentionalCloseRef.current) {
          setAvatarState("error");
          setErrorMessage("The LiveKit voice connection was lost.");
        }
      });
      room.on(RoomEvent.Disconnected, (reason) => {
        if (intentionalCloseRef.current) return;
        const detail = reason ? ` (${String(reason)})` : "";
        setAvatarState("error");
        setErrorMessage(`LiveKit disconnected${detail}. Check that the API key and secret belong to this LiveKit project.`);
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        // Avoid duplicate elements: detach any existing elements for this track first.
        track.detach().forEach((el) => {
          el.pause();
          el.srcObject = null;
          el.remove();
          audioElementsRef.current = audioElementsRef.current.filter((item) => item !== el);
        });
        const element = track.attach() as HTMLAudioElement;
        element.autoplay = true;
        element.setAttribute("aria-hidden", "true");
        document.body.appendChild(element);
        audioElementsRef.current.push(element);
        monitorAudio(element, track as RemoteAudioTrack);
        void element.play().catch(() => {
          setErrorMessage("Audio playback is blocked. Interact with the page and retry the voice session.");
        });
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        const detached = track.detach();
        detached.forEach((element) => {
          if (analyserRef.current?.element === element) {
            stopAudioMonitor();
            setAudioLevel(0);
          }
          element.pause();
          element.srcObject = null;
          element.remove();
          audioElementsRef.current = audioElementsRef.current.filter((item) => item !== element);
        });
      });
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        if (!participant) return;
        try {
          const event = JSON.parse(new TextDecoder().decode(payload)) as VoiceDataEvent;
          if (event.type === "state") {
            const nextState = event.state === "initializing" ? "connecting" : event.state;
            if (["connecting", "listening", "thinking", "speaking"].includes(nextState)) {
              setAvatarState(nextState as AvatarState);
            }
          } else if (event.type === "transcript" && event.role === "assistant") {
            setAssistantTranscript((current) => `${current} ${event.text}`.trim());
          } else if (event.type === "source") {
            setSources((current) => current.some((source) => source.title === event.title) ? current : [...current, event]);
          }
        } catch {
          setErrorMessage("Received an invalid voice event from the agent.");
        }
      });
      room.on(RoomEvent.ParticipantAttributesChanged, (attributes, participant) => {
        // Only react to the remote agent participant, not the local customer mic track.
        if (participant === room.localParticipant) return;
        const agentState = attributes["lk.agent.state"];
        if (agentState === "speaking" || agentState === "thinking" || agentState === "listening") {
          setAvatarState(agentState);
          setStatusMessage(agentState === "speaking" ? "Alt is speaking..." : agentState === "thinking" ? "Checking SLT-MOBITEL knowledge..." : "Listening... Speak naturally");
        }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const isRemoteSpeaking = speakers.some((participant) => participant !== room.localParticipant);
        if (isRemoteSpeaking) {
          if (stateRef.current !== "speaking") {
            setAvatarState("speaking");
            setStatusMessage("Alt is speaking...");
          }
        } else if (stateRef.current === "speaking") {
          setAvatarState("listening");
          setStatusMessage("Listening... Speak naturally");
          setAudioLevel(0);
        }
      });

      await room.connect(livekitUrl, livekitToken);
      if (generation !== generationRef.current) {
        room.disconnect();
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      setIsMuted(false);
      setAvatarState("listening");
      setStatusMessage("Listening... Speak naturally");
    } catch (error) {
      await cleanup();
      setAvatarState("error");
      const errName = error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : "Unable to start the LiveKit voice session.";
      if (errName === "NotAllowedError" || message.toLowerCase().includes("permission") || message.toLowerCase().includes("not allowed")) {
        setErrorMessage("Microphone access was denied. Please allow microphone permissions in your browser and click Retry.");
      } else if (message.includes("token")) {
        setErrorMessage(`${message} Verify the LiveKit key, secret, and URL are from the same project.`);
      } else {
        setErrorMessage(message);
      }
    } finally {
      startingRef.current = false;
    }
  }, [cleanup, language, monitorAudio, setAvatarState, stopAudioMonitor]);

  const endSession = useCallback(async () => {
    intentionalCloseRef.current = true;
    generationRef.current += 1;
    await cleanup();
    startingRef.current = false;
    setIsMuted(false);
    setAssistantTranscript("");
    setAvatarState("idle");
    setStatusMessage("Ready to connect");
  }, [cleanup, setAvatarState]);

  const toggleMute = useCallback(async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    await roomRef.current?.localParticipant.setMicrophoneEnabled(!nextMuted);
    setStatusMessage(nextMuted ? "Microphone muted" : "Listening... Speak naturally");
  }, [isMuted]);

  useEffect(() => () => {
    void cleanup();
  }, [cleanup]);

  return {
    state,
    statusMessage,
    errorMessage,
    isMuted,
    assistantTranscript,
    sources,
    audioLevel,
    startSession,
    endSession,
    toggleMute,
  };
}
