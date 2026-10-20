"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import log from "loglevel";
import { ConnectionState, Room, RoomEvent, Track, setLogLevel } from "livekit-client";
import { fetchLiveKitToken, validateLiveKitCredentials } from "../services/livekitService";

// Set LiveKit client log level to error to silence harmless background region settings warnings
setLogLevel("error");

// Filter out the harmless internal WebSocket tear-down message ("error reading from signal stream")
// which is triggered whenever a session ends, page reloads, or reconnects.
try {
  const signalLogger = log.getLogger("livekit-signal");
  const origError = signalLogger.error.bind(signalLogger);
  signalLogger.error = (msg: unknown, ...args: unknown[]) => {
    if (typeof msg === "string" && msg.includes("error reading from signal stream")) {
      return;
    }
    origError(msg, ...args);
  };
} catch {
  // Ignore logger hook failure in non-browser environments
}

export type AvatarState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type LiveVoiceSource = { title: string; category: string };

export type TavusAvatarStatus = "disabled" | "connecting" | "connected" | "error";

type VoiceDataEvent =
  | { type: "state"; state: AvatarState | "initializing" | "idle" }
  | { type: "transcript"; role: "user" | "assistant"; text: string; final: string }
  | { type: "source"; title: string; category: string }
  | { type: "avatar"; status: "connected" | "disabled" | "unavailable"; identity?: string; conversation_id?: string; reason?: string };

export type UseLiveVoiceSessionOptions = { language?: string };

export function useLiveVoiceSession({ language = "EN" }: UseLiveVoiceSessionOptions = {}) {
  const [state, setState] = useState<AvatarState>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready to connect");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [sources, setSources] = useState<LiveVoiceSource[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  // Tavus avatar status — driven by "avatar" events published by the agent
  const [avatarStatus, setAvatarStatus] = useState<TavusAvatarStatus>("connecting");
  const [avatarError, setAvatarError] = useState<string | undefined>(undefined);
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
  const agentWaitTimerRef = useRef<NodeJS.Timeout | null>(null);

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
    void monitor.context.close().catch(() => undefined);
    analyserRef.current = null;
  }, []);

  const cleanup = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    audioElementsRef.current.forEach((element) => {
      try {
        element.pause();
        element.srcObject = null;
        element.remove();
      } catch {
        // ignore
      }
    });
    audioElementsRef.current = [];
    if (room) {
      try {
        await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        await room.disconnect();
      } catch {
        // ignore disconnect failures during cleanup
      }
    }
    if (agentWaitTimerRef.current) {
      clearTimeout(agentWaitTimerRef.current);
      agentWaitTimerRef.current = null;
    }
    stopAudioMonitor();
    setAudioLevel(0);
  }, [stopAudioMonitor]);

  const monitorAudio = useCallback((element: HTMLAudioElement) => {
    if (analyserRef.current) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioCtx({ latencyHint: "interactive" });
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;

      // Analyze the same element that is audible. A separate MediaStreamSource
      // can report zero energy in some browsers even while the track is playing.
      const source = context.createMediaElementSource(element);

      source.connect(analyser);
      analyser.connect(context.destination);
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
    if (startingRef.current) return;
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
      // ── Fetch LiveKit token via livekitService (Service module pattern) ─────
      const liveKitPayload = await fetchLiveKitToken(language);
      const livekitUrl = liveKitPayload.url.trim();
      const livekitToken = liveKitPayload.token.trim();
      validateLiveKitCredentials(livekitUrl, livekitToken);

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
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!room.canPlaybackAudio) {
          setErrorMessage("Click anywhere on the screen to enable agent voice audio.");
        } else {
          setErrorMessage((current) => (current?.includes("enable agent voice") ? null : current));
        }
      });
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        if (agentWaitTimerRef.current) {
          clearTimeout(agentWaitTimerRef.current);
          agentWaitTimerRef.current = null;
        }
        setErrorMessage((current) => (current?.includes("agent worker") ? null : current));
        // Skip Tavus avatar audio — TavusAvatarView manages that track directly
        // via its own ref to prevent duplicate audio playback.
        if (participant.identity === "tavus-avatar-agent") return;
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
        monitorAudio(element);
        void element.play().catch(() => {
          room.startAudio().catch(() => undefined);
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
      room.on(RoomEvent.ParticipantConnected, () => {
        if (agentWaitTimerRef.current) {
          clearTimeout(agentWaitTimerRef.current);
          agentWaitTimerRef.current = null;
        }
        setErrorMessage((current) => (current?.includes("agent worker") ? null : current));
        setAvatarState("listening");
        setStatusMessage("Alt connected! Listening... Speak naturally");
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (room.remoteParticipants.size === 0) {
          setStatusMessage("Agent disconnected. Waiting for agent to reconnect...");
        }
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
          } else if (event.type === "avatar") {
            // Tavus avatar lifecycle events from the agent worker
            if (event.status === "connected") {
              setAvatarStatus("connected");
              setAvatarError(undefined);
            } else if (event.status === "disabled") {
              setAvatarStatus("disabled");
              setAvatarError(undefined);
            } else if (event.status === "unavailable") {
              setAvatarStatus("error");
              setAvatarError(event.reason);
            }
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
        await room.disconnect().catch(() => undefined);
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      setIsMuted(false);

      if (room.remoteParticipants.size > 0) {
        setAvatarState("listening");
        setStatusMessage("Listening... Speak naturally");
      } else {
        setAvatarState("connecting");
        setStatusMessage("Connected to room. Waiting for Alt voice agent to join...");
        agentWaitTimerRef.current = setTimeout(() => {
          if (roomRef.current && roomRef.current.remoteParticipants.size === 0) {
            setErrorMessage(
              "Voice agent worker is not running. Start it in a second backend terminal: python livekit_agent.py dev"
            );
            setStatusMessage("Waiting for agent worker to start...");
          }
        }, 7000);
      }
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
    setAvatarStatus("connecting");
    setAvatarError(undefined);
    setStatusMessage("Ready to connect");
  }, [cleanup, setAvatarState]);

  const toggleMute = useCallback(async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    await roomRef.current?.localParticipant.setMicrophoneEnabled(!nextMuted);
    setStatusMessage(nextMuted ? "Microphone muted" : "Listening... Speak naturally");
  }, [isMuted]);

  // Unlock browser audio autoplay policy as soon as user clicks anywhere on the page
  useEffect(() => {
    const unlockAudio = () => {
      const room = roomRef.current;
      if (room && !room.canPlaybackAudio) {
        room.startAudio().catch(() => undefined);
      }
    };
    window.addEventListener("click", unlockAudio);
    window.addEventListener("touchstart", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

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
    avatarStatus,
    avatarError,
    room: roomRef.current,
    startSession,
    endSession,
    toggleMute,
  };
}
