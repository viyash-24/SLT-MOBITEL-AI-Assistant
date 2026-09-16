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

  const getStatus = () => {
    if (!isSupported) return "Voice not supported in this browser";
    if (voiceError) return voiceError;
    if (isListening) return "Listening... Speak now";
    if (isSpeaking) return "Assistant is responding...";
    return "Ready to connect";
  };

  const getButtonLabel = () => {
    if (isListening) return "Stop Listening";
    if (isSpeaking) return "Stop Speaking";
    return "Start Conversation";
  };
