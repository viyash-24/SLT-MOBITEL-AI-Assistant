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

  return (
    <div className="voice-agent-page">
      <div className="vap-header">
        <button
          type="button"
          className="vap-back-btn"
          onClick={onBackToChat}
          aria-label="Back to Chat"
        >
          <ArrowLeft size={16} />
          
        </button>

        <h2 className="vap-title text-center">Voice Agent</h2>

        
      </div>

      <div className="vap-body">
        <div
          className={`vap-mic-orb ${isListening ? "vap-orb-listening" : ""} ${isSpeaking ? "vap-orb-speaking" : ""}`}
          role="img"
          aria-label={getStatus()}
        >
          {isListening ? (
            <span className="vap-orb-waves">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </span>
          ) : isSpeaking ? (
            <Volume2 size={38} />
          ) : (
            <Mic size={38} />
          )}
        </div>

        {(isListening || isSpeaking) && currentText && (
          <div className="vap-transcript-box">
            <p>{currentText}</p>
          </div>
        )}

        <p className="vap-status">{getStatus()}</p>

        {voiceError && (
          <div className="vap-error">
            <span>{voiceError}</span>
          </div>
        )}

        <button
          type="button"
          className={`vap-cta-btn ${isListening ? "vap-cta-listening" : ""} ${isSpeaking ? "vap-cta-speaking" : ""}`}
          onClick={handleMainButton}
          disabled={!isSupported}
          aria-label={getButtonLabel()}
        >
          {isListening ? (
            <><MicOff size={18} /><span>Stop Listening</span></>
          ) : isSpeaking ? (
            <><Square size={16} /><span>Stop Speaking</span></>
          ) : (
            <><Mic size={18} /><span>Start Conversation</span></>
          )}
        </button>
