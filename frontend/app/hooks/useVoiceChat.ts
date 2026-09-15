"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API interface declarations for TypeScript compatibility
interface ISpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface ISpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: ISpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
}

interface ISpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: ISpeechRecognitionConstructor;
    webkitSpeechRecognition?: ISpeechRecognitionConstructor;
  }
}

export function cleanTextForSpeech(text: string): string {
  return text
    // Remove markdown image tags
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    // Remove markdown links: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, "")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Remove markdown headers
    .replace(/#{1,6}\s+/g, "")
    // Remove bold and italics
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // Remove blockquotes
    .replace(/^\s*>\s+/gm, "")
    // Remove bullet points / list numbers
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // Remove horizontal rules
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    // Clean table separators
    .replace(/\|/g, " ")
    // Collapse excess spaces and newlines
    .replace(/\s+/g, " ")
    .trim();
}

const LANGUAGE_CODE_MAP: Record<string, string> = {
  EN: "en-US",
  "සිං": "si-LK",
  "த": "ta-LK",
};

type UseVoiceChatProps = {
  language: string;
  onTranscriptComplete?: (transcript: string) => void;
};

export function useVoiceChat({ language, onTranscriptComplete }: UseVoiceChatProps) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const transcriptBufferRef = useRef("");
  const autoSubmitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onTranscriptCompleteRef = useRef(onTranscriptComplete);

  useEffect(() => {
    onTranscriptCompleteRef.current = onTranscriptComplete;
  }, [onTranscriptComplete]);

  // Check browser support for Web Speech API
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasRecognition = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
      const hasSynthesis = "speechSynthesis" in window;
      setIsSupported(hasRecognition && hasSynthesis);
    }
  }, []);

  // Update language of active recognition if changed
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = LANGUAGE_CODE_MAP[language] ?? "en-US";
    }
  }, [language]);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    }
  }, []);

  const speak = useCallback((text: string, messageId?: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceError("Text-to-speech is not supported in this browser.");
      return;
    }

    const cleaned = cleanTextForSpeech(text);
    if (!cleaned) return;

    // Cancel any previous speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleaned);
    const targetLang = LANGUAGE_CODE_MAP[language] ?? "en-US";
    utterance.lang = targetLang;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Pick best matching voice if available
    const voices = window.speechSynthesis.getVoices();
    const langPrefix = targetLang.split("-")[0];
    const matchingVoice = voices.find((v) => v.lang === targetLang) ||
      voices.find((v) => v.lang.startsWith(langPrefix));

    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      if (messageId) {
        setSpeakingMessageId(messageId);
      }
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    };

    utterance.onerror = (e) => {
      if (e.error !== "canceled" && e.error !== "interrupted") {
        setVoiceError("Audio playback encountered an issue.");
      }
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    };

    window.speechSynthesis.speak(utterance);
  }, [language]);

  const stopListening = useCallback(() => {
    if (autoSubmitTimeoutRef.current) {
      clearTimeout(autoSubmitTimeoutRef.current);
      autoSubmitTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore if already stopped
      }
    }
    setIsListening(false);

    // If we have collected speech, trigger submission
    const finalResult = transcriptBufferRef.current.trim();
    if (finalResult && onTranscriptCompleteRef.current) {
      onTranscriptCompleteRef.current(finalResult);
      transcriptBufferRef.current = "";
      setTranscript("");
      setInterimTranscript("");
    }
  }, []);

  const cancelListening = useCallback(() => {
    if (autoSubmitTimeoutRef.current) {
      clearTimeout(autoSubmitTimeoutRef.current);
      autoSubmitTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore if already aborted
      }
    }
    setIsListening(false);
    transcriptBufferRef.current = "";
    setTranscript("");
    setInterimTranscript("");
  }, []);

  const startListening = useCallback(() => {
    setVoiceError(null);

    // Stop speaking if currently speaking
    stopSpeaking();

    if (typeof window === "undefined") return;

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setVoiceError("Voice recognition is not supported in this browser. Please try Chrome, Edge, or Safari.");
      return;
    }

    // Abort existing instance if any
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore
      }
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = LANGUAGE_CODE_MAP[language] ?? "en-US";

      transcriptBufferRef.current = "";
      setTranscript("");
      setInterimTranscript("");

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: ISpeechRecognitionEvent) => {
        let currentInterim = "";
        let currentFinal = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcriptPiece = result[0]?.transcript ?? "";
          if (result.isFinal) {
            currentFinal += transcriptPiece;
          } else {
            currentInterim += transcriptPiece;
          }
        }

        if (currentFinal) {
          transcriptBufferRef.current = (transcriptBufferRef.current + " " + currentFinal).trim();
          setTranscript(transcriptBufferRef.current);
          setInterimTranscript("");
        } else {
          setInterimTranscript(currentInterim);
        }
      };

      recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
        if (event.error === "no-speech") {
          setVoiceError("No speech was detected. Please try speaking again.");
        } else if (event.error === "not-allowed") {
          setVoiceError("Microphone access was denied. Please allow microphone permissions in your browser.");
        } else if (event.error === "audio-capture") {
          setVoiceError("No microphone was found on your device.");
        } else if (event.error !== "aborted") {
          setVoiceError(`Voice input error: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        const finalResult = transcriptBufferRef.current.trim();
        if (finalResult && onTranscriptCompleteRef.current) {
          onTranscriptCompleteRef.current(finalResult);
          transcriptBufferRef.current = "";
          setTranscript("");
          setInterimTranscript("");
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Failed to start speech recognition.");
      setIsListening(false);
    }
  }, [language, stopSpeaking]);

  const clearVoiceError = useCallback(() => {
    setVoiceError(null);
  }, []);

  return {
    isSupported,
    isListening,
    isSpeaking,
    speakingMessageId,
    transcript,
    interimTranscript,
    voiceError,
    startListening,
    stopListening,
    cancelListening,
    speak,
    stopSpeaking,
    clearVoiceError,
  };
}
