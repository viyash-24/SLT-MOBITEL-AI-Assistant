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
