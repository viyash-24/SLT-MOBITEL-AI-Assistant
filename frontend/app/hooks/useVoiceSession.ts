"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sendChatMessage } from "../services/chatService";
import type { ChatMessageData } from "../types/chat";

export type VoiceSessionState =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export type VoiceSessionResult = {
  state: VoiceSessionState;
  transcript: string;
  messages: ChatMessageData[];
  error: string | null;
  isMuted: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  toggleMute: () => void;
  clearMessages: () => void;
  setLanguage: (lang: string) => void;
};

const LANG_MAP: Record<string, string> = {
  EN: "en-US",
  SI: "si-LK",
  TA: "ta-LK",
};

const VOICE_LANG_MAP: Record<string, string> = {
  EN: "en",
  SI: "si",
  TA: "ta",
};

/** Browser-native voice session using Web Speech API + existing /api/chat backend. */
export function useVoiceSession(initialLang = "EN"): VoiceSessionResult {
  const [state, setState] = useState<VoiceSessionState>("idle");
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [language, setLanguageSt] = useState(initialLang);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const sessionIdRef = useRef(`voice-${Date.now()}`);
  const mountedRef = useRef(true);
  const isMutedRef = useRef(false);
  const stateRef = useRef<VoiceSessionState>("idle");

  // Synchronized state setter
  const setVoiceState = useCallback((s: VoiceSessionState) => {
    stateRef.current = s;
    if (mountedRef.current) setState(s);
  }, []);

  // Check browser support
  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) &&
    "speechSynthesis" in window;

  const setLanguage = useCallback((lang: string) => {
    setLanguageSt(lang);
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setVoiceState("idle");
  }, [setVoiceState]);

  const speak = useCallback(
    (text: string, lang: string) => {
      if (isMutedRef.current || !isSupported) {
        setVoiceState("idle");
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = VOICE_LANG_MAP[lang] ?? "en";
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.onend = () => {
        setVoiceState("idle");
      };
      utterance.onerror = () => {
        setVoiceState("idle");
      };
      setVoiceState("speaking");
      window.speechSynthesis.speak(utterance);
    },
    [isSupported, setVoiceState]
  );

  const handleFinalTranscript = useCallback(
    async (text: string, lang: string, currentMessages: ChatMessageData[]) => {
      if (!text.trim() || !mountedRef.current) return;

      const userMsg: ChatMessageData = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, userMsg]);
      setVoiceState("processing");
      setTranscript("");

      try {
        const response = await sendChatMessage(
          text,
          currentMessages,
          sessionIdRef.current,
          "voice"
        );
        if (!mountedRef.current) return;

        const assistantMsg: ChatMessageData = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: response.answer,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          confidence: response.confidence,
          sources: response.sources,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        speak(response.answer, lang);
      } catch (err) {
        if (!mountedRef.current) return;
        const msg =
          err instanceof Error
            ? err.message
            : "Could not reach the assistant. Check the backend.";
        if (mountedRef.current) setError(msg);
        setVoiceState("error");
      }
    },
    [speak, setVoiceState]
  );

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError(
        "Voice chat requires a browser that supports Web Speech API (Chrome or Edge recommended)."
      );
      setVoiceState("error");
      return;
    }

    window.speechSynthesis.cancel();
    setError(null);
    setVoiceState("listening");

    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = LANG_MAP[language] ?? "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    // Capture messages at the time the user starts speaking
    let capturedMessages: ChatMessageData[] = [];
    setMessages((prev) => {
      capturedMessages = prev;
      return prev;
    });

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(final || interim);
      if (final) {
        recognition.stop();
        recognitionRef.current = null;
        void handleFinalTranscript(final, language, capturedMessages);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (!mountedRef.current) return;
      if (event.error === "no-speech") {
        setVoiceState("idle");
        return;
      }
      if (event.error === "not-allowed") {
        setError(
          "Microphone access was denied. Please allow microphone access and try again."
        );
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
      setVoiceState("error");
    };

    recognition.onend = () => {
      if (mountedRef.current && stateRef.current === "listening") {
        setVoiceState("idle");
      }
    };

    recognition.start();
  }, [isSupported, language, handleFinalTranscript, setVoiceState]);

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    if (next) {
      window.speechSynthesis.cancel();
      if (stateRef.current === "speaking") setVoiceState("idle");
    }
  }, [setVoiceState]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setTranscript("");
    setError(null);
    sessionIdRef.current = `voice-${Date.now()}`;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  return {
    state,
    transcript,
    messages,
    error,
    isMuted,
    isSupported,
    startListening,
    stopListening,
    toggleMute,
    clearMessages,
    setLanguage,
  };
}
