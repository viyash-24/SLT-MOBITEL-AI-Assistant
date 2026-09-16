"use client";

import { ArrowLeft, MessageSquare, Mic, MicOff, Square, Volume2 } from "lucide-react";
import Image from "next/image";
import React from "react";

type VoiceAgentPageProps = {
  isListening: boolean;
  isSpeaking: boolean;
  transcript?: string;
  interimTranscript?: string;
  voiceError?: string | null;
  isSupported?: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  onCancelListening: () => void;
  onStopSpeaking: () => void;
  onBackToChat: () => void;
};

export function VoiceAgentPage({
  isListening,
  isSpeaking,
  transcript,
  interimTranscript,
  voiceError,
  isSupported = true,
  onStartListening,
  onStopListening,
  onCancelListening,
  onStopSpeaking,
  onBackToChat,
}: VoiceAgentPageProps) {
  const currentText = transcript || interimTranscript;

  const handleMainButton = () => {
    if (isListening) {
      onStopListening();
    } else if (isSpeaking) {
      onStopSpeaking();
    } else {
      onStartListening();
    }
  };
