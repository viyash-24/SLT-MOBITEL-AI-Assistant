"use client";

/**
 * useVoiceSession — SLT-MOBITEL AI Voice Assistant
 *
 * Full-duplex Gemini Live bidirectional streaming:
 *  - 16 kHz PCM uplink via AudioWorklet with phase-continuous resampling
 *  - 24 kHz PCM downlink as binary WebSocket frames
 *  - Jitter-buffered smooth audio playback without artificial silence gaps
 *  - Synchronized, real-time transcripts for You (User) and Agent sections
 *  - Instant barge-in / interruption handling
 *  - Resilient connection lifecycle and resource cleanup
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSource } from "../types/chat";
import type { VoiceState } from "../components/AvatarView";

export type UseVoiceSessionOptions = {
  language: string;
};

const OUTPUT_SAMPLE_RATE = 24000;
const MAX_RECONNECT_ATTEMPTS = 2;
const RECONNECT_DELAY_MS = 450;

// Jitter buffer: how far ahead we schedule audio relative to AudioContext clock.
// 120 ms gives enough runway to absorb WebSocket & scheduler jitter without
// adding perceptible latency to the start of a turn.
const JITTER_BUFFER_S = 0.12;

function getVoiceWebSocketUrl(sessionId: string, language: string): string {
  const envApi = process.env.NEXT_PUBLIC_API_URL;
  if (envApi) {
    const wsBase = envApi.replace(/^http/, "ws");
    return `${wsBase}/api/voice/live?session_id=${encodeURIComponent(sessionId)}&language=${encodeURIComponent(language)}`;
  }

  if (typeof window !== "undefined") {
    const isHttps = window.location.protocol === "https:";
    const protocol = isHttps ? "wss:" : "ws:";
    const host = `${window.location.hostname || "127.0.0.1"}:8000`;
    return `${protocol}//${host}/api/voice/live?session_id=${encodeURIComponent(sessionId)}&language=${encodeURIComponent(language)}`;
  }

  return `ws://127.0.0.1:8000/api/voice/live?session_id=${encodeURIComponent(sessionId)}&language=${encodeURIComponent(language)}`;
}

function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array | null {
  const evenLength = buffer.byteLength - (buffer.byteLength % 2);
  if (evenLength < 2) return null;
  const copy = new ArrayBuffer(evenLength);
  new Uint8Array(copy).set(new Uint8Array(buffer, 0, evenLength));
  const int16 = new Int16Array(copy);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

function decodeBase64Pcm(base64Data: string): ArrayBuffer {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function useVoiceSession({ language = "EN" }: UseVoiceSessionOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready to Connect");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);

  const isMutedRef = useRef(isMuted);
  const stateRef = useRef<VoiceState>(state);
  const wsRef = useRef<WebSocket | null>(null);
  const isClosingRef = useRef(false);
  const userEndedRef = useRef(false);
  const startLockRef = useRef(false);
  const connGenRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnCompleteRef = useRef(true);
  const languageRef = useRef(language);
  const sessionIdRef = useRef<string>("");

  const micStreamRef = useRef<MediaStream | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const micWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesSetRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playbackEpochRef = useRef(0);
  const terminalErrorRef = useRef(false);
  const microphoneErrorRef = useRef(false);

  const animFrameRef = useRef<number | null>(null);
  const isSpeakingRef = useRef(false);
  const lastLevelRef = useRef(0);
  const lastVisualizerUpdateRef = useRef(0);
  const scheduleReconnectRef = useRef<(generation: number) => void>(() => {});

  useEffect(() => {
    isMutedRef.current = isMuted;
    for (const track of micStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const stopAllPlayback = useCallback(() => {
    playbackEpochRef.current += 1;
    for (const source of activeSourcesSetRef.current) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        /* already finished */
      }
    }
    activeSourcesSetRef.current.clear();
    isSpeakingRef.current = false;
    if (playbackContextRef.current) {
      nextPlayTimeRef.current = playbackContextRef.current.currentTime;
    } else {
      nextPlayTimeRef.current = 0;
    }
  }, []);

  const closeSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const socket = wsRef.current;
    wsRef.current = null;
    if (!socket) return;
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "end" }));
      }
      socket.close();
    } catch {
      /* ignore */
    }
  }, []);

  const cleanupAudio = useCallback(() => {
    stopAllPlayback();

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (micWorkletNodeRef.current) {
      micWorkletNodeRef.current.port.onmessage = null;
      micWorkletNodeRef.current.disconnect();
      micWorkletNodeRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    if (captureContextRef.current) {
      captureContextRef.current.close().catch(() => {});
      captureContextRef.current = null;
    }

    if (playbackContextRef.current) {
      playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }
    playbackAnalyserRef.current = null;
    micAnalyserRef.current = null;

    isClosingRef.current = true;
    closeSocket();
    setAudioLevel(0);
  }, [closeSocket, stopAllPlayback]);

  const startVisualizerLoop = useCallback(() => {
    const updateMeter = (timestamp: number) => {
      const elapsed = timestamp - lastVisualizerUpdateRef.current;

      if (elapsed >= 45) {
        lastVisualizerUpdateRef.current = timestamp;
        let rawLevel = 0;

        if (isSpeakingRef.current && playbackAnalyserRef.current) {
          const data = new Uint8Array(playbackAnalyserRef.current.frequencyBinCount);
          playbackAnalyserRef.current.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          rawLevel = Math.min(1, (sum / data.length / 255) * 1.6);
        } else if (!isMutedRef.current && micAnalyserRef.current) {
          const data = new Uint8Array(micAnalyserRef.current.frequencyBinCount);
          micAnalyserRef.current.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          rawLevel = Math.min(1, (sum / data.length / 255) * 2.0);
        }

        const smoothed = lastLevelRef.current * 0.35 + rawLevel * 0.65;
        lastLevelRef.current = smoothed;
        const effectiveLevel = smoothed < 0.03 ? 0 : Number(smoothed.toFixed(2));
        setAudioLevel((prev) => (prev === 0 && effectiveLevel === 0 ? prev : effectiveLevel));
      }

      animFrameRef.current = requestAnimationFrame(updateMeter);
    };

    if (!animFrameRef.current) {
      animFrameRef.current = requestAnimationFrame(updateMeter);
    }
  }, []);

  const prewarmPlaybackContext = useCallback(() => {
    if (playbackContextRef.current?.state === "closed") {
      playbackContextRef.current = null;
      playbackAnalyserRef.current = null;
    }
    if (playbackContextRef.current) {
      if (playbackContextRef.current.state === "suspended") {
        playbackContextRef.current.resume().catch(() => {});
      }
      return;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    let ctx: AudioContext;
    try {
      ctx = new AudioCtx({ sampleRate: OUTPUT_SAMPLE_RATE, latencyHint: "interactive" });
    } catch {
      ctx = new AudioCtx({ latencyHint: "interactive" });
    }
    playbackContextRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    playbackAnalyserRef.current = analyser;
    analyser.connect(ctx.destination);

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    nextPlayTimeRef.current = ctx.currentTime;
  }, []);

  const playPcmBuffer = useCallback(
    (pcmBuffer: ArrayBuffer) => {
      try {
        if (!playbackContextRef.current) {
          prewarmPlaybackContext();
        }

        const ctx = playbackContextRef.current;
        if (!ctx || ctx.state === "closed") {
          playbackContextRef.current = null;
          playbackAnalyserRef.current = null;
          prewarmPlaybackContext();
        }
        const activeContext = playbackContextRef.current;
        if (!activeContext || activeContext.state === "closed") return;
        if (activeContext.state === "suspended") {
          activeContext.resume().catch(() => {});
        }

        const float32 = pcm16ToFloat32(pcmBuffer);
        if (!float32 || float32.length === 0) return;

        const audioBuffer = activeContext.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
        audioBuffer.getChannelData(0).set(float32);

        const source = activeContext.createBufferSource();
        source.buffer = audioBuffer;
        const analyser = playbackAnalyserRef.current!;
        source.connect(analyser);

        const epoch = playbackEpochRef.current;
        const now = activeContext.currentTime;

        // Dynamic jitter buffer:
        // When assistant starts speaking (!isSpeakingRef), give an 80ms cushion
        // so upcoming chunks have time to queue up smoothly.
        // If mid-sentence packets ever underflow (nextPlayTime < now), resume
        // IMMEDIATELY (within 5ms) to eliminate audible silence holes/breaks.
        if (!isSpeakingRef.current || nextPlayTimeRef.current < now) {
          const leadTime = isSpeakingRef.current ? 0.005 : 0.080;
          nextPlayTimeRef.current = Math.max(now + leadTime, nextPlayTimeRef.current);
        }

        const playTime = nextPlayTimeRef.current;
        source.start(playTime);
        nextPlayTimeRef.current += audioBuffer.duration;
        turnCompleteRef.current = false;

        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true;
          setState("speaking");
          setStatusMessage("AI Assistant is speaking...");
        }

        activeSourcesSetRef.current.add(source);

        source.onended = () => {
          if (epoch !== playbackEpochRef.current) return;
          activeSourcesSetRef.current.delete(source);
          if (activeSourcesSetRef.current.size === 0 && turnCompleteRef.current) {
            isSpeakingRef.current = false;
            setState("listening");
            setStatusMessage("Listening to you...");
          }
        };
      } catch (err) {
        console.error("Error playing audio chunk:", err);
      }
    },
    [prewarmPlaybackContext]
  );

  const initMicrophone = useCallback(async (generation: number) => {
    const isCurrent = () => generation === connGenRef.current && !userEndedRef.current;
    microphoneErrorRef.current = false;
    if (micStreamRef.current && captureContextRef.current) {
      if (captureContextRef.current.state === "suspended") {
        await captureContextRef.current.resume();
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedRef.current;
      });
      micStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      let ctx: AudioContext;
      try {
        ctx = new AudioCtx({ sampleRate: 16000, latencyHint: "interactive" });
      } catch {
        ctx = new AudioCtx({ latencyHint: "interactive" });
      }
      captureContextRef.current = ctx;

      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        await ctx.close().catch(() => {});
        if (captureContextRef.current === ctx) captureContextRef.current = null;
        return;
      }

      const sourceNode = ctx.createMediaStreamSource(stream);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      micAnalyserRef.current = analyser;
      sourceNode.connect(analyser);

      let workletLoaded = false;
      try {
        // Inline the AudioWorklet processor as a Blob URL — no static file needed.
        // FRAME_SIZE = 1280 samples @ 16 kHz → 80 ms per chunk (12.5 packets/s).
        // Prevents socket buffer bloat while keeping latency below 80 ms.
        const processorCode = `
          const FRAME_SIZE = 1280;
          class AudioCaptureProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this._buffer = new Float32Array(FRAME_SIZE);
              this._offset = 0;
            }
            process(inputs) {
              const channel = inputs?.[0]?.[0];
              if (!channel || channel.length === 0) return true;
              let srcOffset = 0;
              while (srcOffset < channel.length) {
                const copyLen = Math.min(FRAME_SIZE - this._offset, channel.length - srcOffset);
                this._buffer.set(channel.subarray(srcOffset, srcOffset + copyLen), this._offset);
                this._offset += copyLen;
                srcOffset += copyLen;
                if (this._offset >= FRAME_SIZE) {
                  const pcm16 = new Int16Array(FRAME_SIZE);
                  let sumSq = 0;
                  for (let i = 0; i < FRAME_SIZE; i++) {
                    const sample = this._buffer[i];
                    sumSq += sample * sample;
                    const s = Math.max(-1.0, Math.min(1.0, sample));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                  }
                  const rms = Math.sqrt(sumSq / FRAME_SIZE);
                  this.port.postMessage({ buffer: pcm16.buffer, rms }, [pcm16.buffer]);
                  this._offset = 0;
                }
              }
              return true;
            }
          }
          registerProcessor("audio-capture-processor", AudioCaptureProcessor);
        `;
        // Inline self-contained AudioWorklet data URI — zero HTTP requests, zero static files, zero 404s.
        const workletUri = "data:text/javascript;charset=utf-8," + encodeURIComponent(processorCode);
        await ctx.audioWorklet.addModule(workletUri);

        if (!isCurrent()) {
          await ctx.close().catch(() => {});
          stream.getTracks().forEach((track) => track.stop());
          if (captureContextRef.current === ctx) captureContextRef.current = null;
          return;
        }
        const workletNode = new AudioWorkletNode(ctx, "audio-capture-processor");
        micWorkletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; rms: number }>) => {
          const ws = wsRef.current;
          if (isMutedRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
          const { buffer, rms } = event.data;

          // Acoustic echo suppression:
          // If the AI Assistant is currently speaking, do NOT forward audio unless
          // the user speaks loudly (rms >= 0.12) to intentionally interrupt.
          // This prevents speaker bleed from cutting the assistant off mid-sentence.
          if (isSpeakingRef.current && rms < 0.12) {
            return;
          }

          ws.send(buffer);
        };

        sourceNode.connect(workletNode);
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        workletNode.connect(silentGain);
        silentGain.connect(ctx.destination);

        workletLoaded = true;
        console.log(`[Voice] AudioWorklet active @ ${ctx.sampleRate}Hz (80ms frames)`);
      } catch {
        // Fallback to ScriptProcessorNode cleanly without noisy console warnings
      }

      if (!workletLoaded) {
        let phase = 0.0;
        const ratio = ctx.sampleRate / 16000.0;
        // 256-sample buffer → ~16 ms latency at 16 kHz (was 1024 → ~64 ms)
        const processor = ctx.createScriptProcessor(256, 1, 1);
        scriptProcessorRef.current = processor;

        processor.onaudioprocess = (e) => {
          const ws = wsRef.current;
          if (isMutedRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
          const channel = e.inputBuffer.getChannelData(0);

          // Acoustic echo suppression for ScriptProcessor fallback:
          if (isSpeakingRef.current) {
            let sumSq = 0;
            for (let i = 0; i < channel.length; i++) {
              sumSq += channel[i] * channel[i];
            }
            const rms = Math.sqrt(sumSq / channel.length);
            if (rms < 0.12) return;
          }

          if (ctx.sampleRate === 16000) {
            const pcm16 = new Int16Array(channel.length);
            for (let i = 0; i < channel.length; i++) {
              const s = Math.max(-1, Math.min(1, channel[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            if (pcm16.length > 0) ws.send(pcm16.buffer);
            return;
          }

          const outSamples: number[] = [];
          while (phase < channel.length) {
            const posFloor = Math.floor(phase);
            const posCeil = Math.min(posFloor + 1, channel.length - 1);
            const frac = phase - posFloor;
            const sample = channel[posFloor] * (1.0 - frac) + channel[posCeil] * frac;
            const s = Math.max(-1, Math.min(1, sample));
            outSamples.push(s < 0 ? s * 0x8000 : s * 0x7fff);
            phase += ratio;
          }
          phase -= channel.length;

          if (outSamples.length > 0) {
            const pcm16 = new Int16Array(outSamples);
            ws.send(pcm16.buffer);
          }
        };

        sourceNode.connect(processor);
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        processor.connect(silentGain);
        silentGain.connect(ctx.destination);
        console.log(`[Voice] ScriptProcessor active @ ${ctx.sampleRate}Hz`);
      }
    } catch (err) {
      console.warn("Microphone access error:", err);
      if (!isCurrent()) return;
      microphoneErrorRef.current = true;
      setState("error");
      setErrorMessage("Please grant microphone access to talk with the AI Assistant.");
      setStatusMessage("Microphone Required");
    }
  }, []);

  const startSession = useCallback(async () => {
    if (startLockRef.current) return;
    startLockRef.current = true;
    userEndedRef.current = false;
    terminalErrorRef.current = false;

    const generation = ++connGenRef.current;
    isClosingRef.current = true;
    stopAllPlayback();
    closeSocket();
    isClosingRef.current = false;

    setErrorMessage(null);
    if (reconnectAttemptsRef.current === 0) {
      setUserTranscript("");
      setAssistantTranscript("");
      setSources([]);
    }
    setState("connecting");
    setStatusMessage("Connecting to Gemini Live API...");
    turnCompleteRef.current = true;

    sessionIdRef.current = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    try {
      prewarmPlaybackContext();
      void initMicrophone(generation);

      if (generation !== connGenRef.current || userEndedRef.current) {
        return;
      }

      const wsUrl = getVoiceWebSocketUrl(sessionIdRef.current, languageRef.current);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      const isCurrent = () => generation === connGenRef.current && ws === wsRef.current;

      ws.onopen = () => {
        if (!isCurrent()) return;
        startVisualizerLoop();
      };

      ws.onmessage = (event) => {
        if (!isCurrent()) return;

        if (event.data instanceof ArrayBuffer) {
          playPcmBuffer(event.data);
          return;
        }

        if (typeof Blob !== "undefined" && event.data instanceof Blob) {
          void event.data.arrayBuffer().then((buffer) => {
            if (isCurrent()) playPcmBuffer(buffer);
          });
          return;
        }

        if (typeof event.data !== "string") {
          return;
        }

        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "ready":
              reconnectAttemptsRef.current = 0;
              if (!microphoneErrorRef.current) {
                setState("listening");
                setStatusMessage("Connected. How can I help you today?");
              }
              break;

            case "turn_start":
              if (msg.speaker === "user") {
                if (isSpeakingRef.current) {
                  stopAllPlayback();
                }
                // When a new user speech turn begins, clear previous assistant response
                setAssistantTranscript("");
                setSources([]);
                if (stateRef.current !== "listening") {
                  setState("listening");
                  setStatusMessage("Listening to you...");
                }
              }
              break;

            case "audio":
              if (msg.data) playPcmBuffer(decodeBase64Pcm(msg.data));
              break;

            case "interrupted":
              stopAllPlayback();
              turnCompleteRef.current = true;
              setUserTranscript("");
              setAssistantTranscript("");
              setSources([]);
              setState("listening");
              setStatusMessage("Listening to you...");
              break;

            case "turn_complete":
              turnCompleteRef.current = true;
              if (msg.user_transcript) setUserTranscript(msg.user_transcript);
              if (msg.assistant_transcript) setAssistantTranscript(msg.assistant_transcript);
              if (activeSourcesSetRef.current.size === 0) {
                isSpeakingRef.current = false;
                setState("listening");
                setStatusMessage("Listening to you...");
              }
              break;

            case "transcript":
              if (msg.role === "user" && typeof msg.text === "string" && msg.text) {
                setUserTranscript(msg.text);
                // When user speech is streaming, clear stale assistant transcript from prior turn
                if (turnCompleteRef.current) {
                  turnCompleteRef.current = false;
                  setAssistantTranscript("");
                  setSources([]);
                }
              } else if (msg.role === "assistant" && typeof msg.text === "string" && msg.text) {
                setAssistantTranscript(msg.text);
              }
              break;

            case "sources":
              if (Array.isArray(msg.sources)) setSources(msg.sources);
              break;

            case "status":
              if (msg.state === "thinking") {
                setState("thinking");
                setStatusMessage(msg.detail || "Searching SLT-MOBITEL knowledge...");
              } else if (msg.state === "speaking") {
                if (isSpeakingRef.current) {
                  setState("speaking");
                  setStatusMessage("AI Assistant is speaking...");
                }
              }
              break;

            case "disconnected":
              console.warn("[Voice] Backend reported disconnection:", msg.message);
              scheduleReconnectRef.current(generation);
              break;

            case "error":
              terminalErrorRef.current = true;
              setState("error");
              setErrorMessage(msg.message || "Voice session error occurred.");
              setStatusMessage("Error");
              break;

            default:
              break;
          }
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };

      ws.onerror = () => {
        if (!isCurrent() || isClosingRef.current) return;
        console.error("[Voice] WebSocket error");
        setState("error");
        setErrorMessage("Unable to connect to the voice assistant. Ensure backend is running.");
        setStatusMessage("Connection Failed");
      };

      ws.onclose = (event) => {
        if (generation !== connGenRef.current) return;
        if (wsRef.current === ws) wsRef.current = null;
        if (userEndedRef.current || isClosingRef.current) {
          setState("idle");
          setStatusMessage("Call Ended");
          return;
        }
        console.log(`[Voice] WebSocket closed: code=${event.code}`);
        scheduleReconnectRef.current(generation);
      };
    } catch (err) {
      console.error("Failed to start voice session:", err);
      setState("error");
      setErrorMessage("Failed to start voice session. Check server status.");
      setStatusMessage("Connection Failed");
    } finally {
      startLockRef.current = false;
    }
  }, [closeSocket, initMicrophone, playPcmBuffer, prewarmPlaybackContext, startVisualizerLoop, stopAllPlayback]);

  const scheduleReconnect = useCallback((generation: number) => {
    if (userEndedRef.current || terminalErrorRef.current || generation !== connGenRef.current) return;
    if (reconnectTimerRef.current) return;
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setState("error");
      setErrorMessage("Voice connection dropped. Please retry.");
      setStatusMessage("Connection Lost");
      return;
    }
    reconnectAttemptsRef.current += 1;
    setStatusMessage("Connection lost. Reconnecting...");
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (userEndedRef.current || terminalErrorRef.current || generation !== connGenRef.current) return;
      void startSession();
    }, RECONNECT_DELAY_MS);
  }, [startSession]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  const endSession = useCallback(() => {
    userEndedRef.current = true;
    connGenRef.current += 1;
    startLockRef.current = false;
    reconnectAttemptsRef.current = 0;
    cleanupAudio();
    isClosingRef.current = false;
    setState("idle");
    setStatusMessage("Call Ended");
  }, [cleanupAudio]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  useEffect(() => {
    return () => {
      userEndedRef.current = true;
      startLockRef.current = false;
      cleanupAudio();
    };
  }, [cleanupAudio]);

  return {
    state,
    statusMessage,
    errorMessage,
    isMuted,
    userTranscript,
    assistantTranscript,
    sources,
    audioLevel,
    startSession,
    endSession,
    toggleMute,
  };
}
