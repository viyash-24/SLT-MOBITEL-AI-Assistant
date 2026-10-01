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
  onInterrupted?: () => void;
};

export function useLiveVoiceSession({
  language = "EN",
  onInterrupted,
}: UseLiveVoiceSessionOptions = {}) {
  const [state, setState] = useState<AvatarState>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("Ready to connect");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState<string>("");
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
