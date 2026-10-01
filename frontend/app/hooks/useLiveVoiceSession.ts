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
