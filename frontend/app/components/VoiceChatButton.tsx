"use client";

import { AlertCircle, Check, Mic, MicOff, Square, Volume2, X } from "lucide-react";
import React from "react";

type VoiceChatButtonProps = {
  isListening: boolean;
  isSpeaking: boolean;
  transcript?: string;
  interimTranscript?: string;
  voiceError?: string | null;
  onStartListening: () => void;
  onStopListening: () => void;
  onCancelListening: () => void;
  onStopSpeaking: () => void;
  onClearError?: () => void;
  isSupported?: boolean;
};

export function VoiceChatButton({
  isListening,
  isSpeaking,
  transcript = "",
  interimTranscript = "",
  voiceError,
  onStartListening,
  onStopListening,
  onCancelListening,
  onStopSpeaking,
  onClearError,
  isSupported = true,
}: VoiceChatButtonProps) {
  const currentText = transcript || interimTranscript;
