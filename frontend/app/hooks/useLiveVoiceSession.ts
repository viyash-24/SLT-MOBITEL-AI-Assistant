"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AvatarState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type LiveVoiceSource = { title: string; category: string };

export type UseLiveVoiceSessionOptions = {
  language?: string;
};

export function useLiveVoiceSession({
  language = "EN",
}: UseLiveVoiceSessionOptions = {}) {
  const [state, setState] = useState<AvatarState>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("Ready to connect");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [assistantTranscript, setAssistantTranscript] = useState<string>("");
  const [sources, setSources] = useState<LiveVoiceSource[]>([]);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const isMutedRef = useRef(false);
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  // stateRef mirrors state to avoid stale-closure bugs in async callbacks
  const stateRef = useRef<AvatarState>("idle");

  // intentionalCloseRef: true when user explicitly clicks "End Conversation"
  // prevents auto-reconnect on user-initiated close
  const intentionalCloseRef = useRef(false);

  // startSessionRef: always points to the latest startSession so ws.onclose
  // can call it without capturing a stale closure
  const startSessionRef = useRef<(() => void) | null>(null);

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Atomic state setter that keeps stateRef in sync immediately (no render lag)
  const setStateSynced = useCallback((s: AvatarState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // ── Audio: stop playback ──────────────────────────────────────────────────
  const stopAudioPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        /* already stopped */
      }
    }
    activeSourcesRef.current = [];
    if (outputAudioCtxRef.current) {
      nextPlayTimeRef.current = outputAudioCtxRef.current.currentTime;
    }
  }, []);

  // ── Full cleanup (audio + mic + WS) ───────────────────────────────────────
  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    stopAudioPlayback();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {}
      processorRef.current = null;
    }

    if (micStreamRef.current) {
      for (const t of micStreamRef.current.getTracks()) t.stop();
      micStreamRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      try {
        inputAudioCtxRef.current.close();
      } catch {}
      inputAudioCtxRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      try {
        outputAudioCtxRef.current.close();
      } catch {}
      outputAudioCtxRef.current = null;
    }

    // Null analysers — they belong to the closed contexts above.
    // Reusing them in a new context causes InvalidAccessError.
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    setAudioLevel(0);
  }, [stopAudioPlayback]);

  // ── Audio energy loop for waveform visualizer ─────────────────────────────
  const updateAudioEnergy = useCallback(() => {
    const loop = () => {
      let level = 0;
      if (activeSourcesRef.current.length > 0 && outputAnalyserRef.current) {
        const d = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
        outputAnalyserRef.current.getByteFrequencyData(d);
        let sum = 0;
        for (let i = 0; i < d.length; i++) sum += d[i];
        level = Math.min(1, (sum / d.length) / 100);
      } else if (inputAnalyserRef.current && !isMutedRef.current) {
        const d = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
        inputAnalyserRef.current.getByteFrequencyData(d);
        let sum = 0;
        for (let i = 0; i < d.length; i++) sum += d[i];
        level = Math.min(1, (sum / d.length) / 100);
      }
      setAudioLevel(level);
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(loop);
  }, []);

  // ── Play a base64-encoded 24kHz PCM chunk from the assistant ─────────────
  const playPcmChunk = useCallback(
    (base64Data: string) => {
      try {
        // Create / resume output AudioContext
        if (!outputAudioCtxRef.current) {
          const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          outputAudioCtxRef.current = new AC({ sampleRate: 24000 });
        }
        const ctx = outputAudioCtxRef.current;
        if (ctx.state === "suspended") ctx.resume();

        // Re-create analyser if context changed (cross-context guard)
        if (
          !outputAnalyserRef.current ||
          outputAnalyserRef.current.context !== ctx
        ) {
          outputAnalyserRef.current = ctx.createAnalyser();
          outputAnalyserRef.current.fftSize = 256;
          outputAnalyserRef.current.connect(ctx.destination);
        }

        // Decode base64 → Int16 PCM → Float32
        const binary = window.atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const numSamples = Math.floor(bytes.length / 2);
        if (numSamples === 0) return;

        const f32 = new Float32Array(numSamples);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < numSamples; i++) {
          const s = view.getInt16(i * 2, true);
          f32[i] = s < 0 ? s / 32768 : s / 32767;
        }

        const buf = ctx.createBuffer(1, numSamples, 24000);
        buf.getChannelData(0).set(f32);

        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.connect(outputAnalyserRef.current);

        const now = ctx.currentTime;
        const startAt = Math.max(now, nextPlayTimeRef.current);
        source.start(startAt);
        nextPlayTimeRef.current = startAt + buf.duration;

        activeSourcesRef.current.push(source);
        source.onended = () => {
          activeSourcesRef.current = activeSourcesRef.current.filter(
            (s) => s !== source
          );
          // When all audio drains → return to listening
          if (
            activeSourcesRef.current.length === 0 &&
            stateRef.current === "speaking"
          ) {
            stateRef.current = "listening";
            setState("listening");
            setStatusMessage("Listening... Speak naturally");
          }
        };

        setStateSynced("speaking");
        setStatusMessage("Alt is speaking...");
      } catch (err) {
        console.error("playPcmChunk error:", err);
      }
    },
    [setStateSynced]
  );

  // ── Start a live voice session ────────────────────────────────────────────
  const startSession = useCallback(async () => {
    // Reset intentional-close flag on every new session start
    intentionalCloseRef.current = false;

    cleanup();
    setErrorMessage(null);
    setStateSynced("connecting");
    setStatusMessage("Connecting to SLT-MOBITEL Live Assistant...");
    setAssistantTranscript("");
    setSources([]);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not supported in this browser.");
      }

      // 1. Request microphone (audio-only, voice-optimised)
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        micStreamRef.current = stream;
      } catch (micErr: unknown) {
        const e = micErr as { name?: string };
        if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
          throw new Error(
            "Microphone permission denied. Please allow microphone access in browser settings."
          );
        }
        if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
          throw new Error("No microphone found on your device.");
        }
        throw new Error(
          "Unable to access microphone. Please check your audio settings."
        );
      }

      // 2. Input AudioContext at 16kHz
      //    Buffer size 512 → 32ms chunks (much lower latency than 2048=128ms)
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const inputCtx = new AC({ sampleRate: 16000 });
      inputAudioCtxRef.current = inputCtx;

      const srcNode = inputCtx.createMediaStreamSource(stream);
      const analyser = inputCtx.createAnalyser();
      analyser.fftSize = 256;
      inputAnalyserRef.current = analyser;
      srcNode.connect(analyser);

      const processor = inputCtx.createScriptProcessor(1024, 1, 1);
      processorRef.current = processor;

      // 3. WebSocket to FastAPI backend with actual mic sampleRate
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const proto = apiBase.startsWith("https") ? "wss:" : "ws:";
      const host = apiBase.replace(/^https?:\/\//, "");
      const sid = `live-${Date.now()}`;
      const actualSampleRate = inputCtx.sampleRate || 16000;
      const wsUrl = `${proto}//${host}/api/voice/live?session_id=${sid}&language=${encodeURIComponent(language)}&sample_rate=${actualSampleRate}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        setStateSynced("listening");
        setStatusMessage("Connected! Start speaking to Alt...");
