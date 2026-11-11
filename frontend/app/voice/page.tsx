"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Mic, MicOff, Square, AlertCircle, Trash2, Volume2, VolumeX } from "lucide-react";
import { VoiceVisualizer } from "../components/VoiceVisualizer";
import { useVoiceSession } from "../hooks/useVoiceSession";
import { ChatMessage } from "../components/ChatMessage";

const LANGUAGES = [
  { code: "EN", label: "English" },
  { code: "SI", label: "සිංහල" },
  { code: "TA", label: "தமிழ்" },
] as const;

const STATE_LABELS: Record<string, string> = {
  idle: "Ready to talk",
  listening: "Listening…",
  processing: "Thinking…",
  speaking: "Speaking…",
  error: "Error",
};

export default function VoiceAssistantPage() {
  const [language, setLanguageSt] = useState<"EN" | "SI" | "TA">("EN");
  const [openSource, setOpenSource] = useState<string | null>(null);

  const {
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
  } = useVoiceSession(language);

  const isListening = state === "listening";
  const isProcessing = state === "processing";
  const isSpeaking = state === "speaking";
  const isError = state === "error";
  const busy = isListening || isProcessing || isSpeaking;

  const handleLanguageChange = (lang: "EN" | "SI" | "TA") => {
    setLanguageSt(lang);
    setLanguage(lang);
  };

  const statusLabel = isError
    ? (error ?? "Error")
    : (STATE_LABELS[state] ?? "Ready");

  const dotClass = isListening
    ? "dot-emerald"
    : isSpeaking || isProcessing
    ? "dot-amber"
    : isError
    ? "dot-red"
    : "dot-muted";

  return (
    <div className="live-avatar-container">
      <div className="live-avatar-ambient">
        <div className={`ambient-glow ${busy ? "active" : "idle"}`} />
      </div>

      {/* ── Header ── */}
      <header className="live-avatar-header">
        <div className="header-left">
          <Link href="/" className="back-link" aria-label="Back to Chat">
            <ArrowLeft size={18} />
            <span>Back to Chat</span>
          </Link>
          <div className="brand-badge">
            <Image src="/images/emblem.svg" alt="SLT-MOBITEL" width={96} height={34} />
          </div>
        </div>

        <div className="header-center">
          <div className="live-status-pill" role="status">
            <span className={`status-dot ${dotClass}`} />
            <span className="status-text">{statusLabel}</span>
          </div>
        </div>

        <div className="header-right">
          <label className="avatar-language-label">
            Language
            <select
              className="lang-picker-btn"
              value={language}
              disabled={busy}
              onChange={(e) => handleLanguageChange(e.target.value as typeof language)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {/* ── Main stage ── */}
      <main className="live-avatar-stage voice-chat-stage">
        <div className="avatar-frame-wrap">
          <div className="avatar-identity">
            <h1>Voice Chat with SLT Avatar</h1>
            <p>Speak naturally and hear your assistant respond.</p>
          </div>

          {!isSupported && (
            <div className="avatar-error-banner" role="alert">
              <AlertCircle size={18} />
              <span>
                Your browser does not support the Web Speech API. Please use
                Chrome or Edge for voice chat.
              </span>
            </div>
          )}

          {/* Waveform visualizer */}
          <div className="voice-visualizer-wrap">
            <VoiceVisualizer state={state} />
          </div>

          {/* Live transcript */}
          {transcript && (
            <div className="voice-transcript" role="status" aria-live="polite">
              <span className="transcript-label">You said:</span> {transcript}
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="avatar-error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {/* Speaking assistant status */}
          <div className="avatar-status-caption">
            {isSpeaking && (
              <span>SLT Avatar is speaking — click Stop or Mute to interrupt.</span>
            )}
            {isListening && (
              <span>Listening… speak your question now.</span>
            )}
            {isProcessing && (
              <span>Processing your question…</span>
            )}
          </div>

          {/* Controls */}
          <div className="controls-group">
            {/* Start / tap to listen */}
            {!busy && (
              <button
                className="control-btn mute-btn"
                onClick={startListening}
                disabled={!isSupported}
              >
                <Mic size={18} />
                <span>{isError ? "Try again" : "Start voice chat"}</span>
              </button>
            )}

            {/* Stop listening */}
            {isListening && (
              <button
                className="control-btn voice-stop-btn"
                onClick={stopListening}
              >
                <Square size={16} />
                <span>Stop listening</span>
              </button>
            )}

            {/* Mute / unmute TTS */}
            {(isSpeaking || messages.length > 0) && (
              <button
                className={`control-btn mute-btn ${isMuted ? "muted" : ""}`}
                onClick={toggleMute}
                aria-pressed={isMuted}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                <span>{isMuted ? "Unmute speaker" : "Mute speaker"}</span>
              </button>
            )}

            {/* Clear conversation */}
            {messages.length > 0 && !busy && (
              <button
                className="control-btn"
                onClick={clearMessages}
                title="Clear conversation"
              >
                <Trash2 size={16} />
                <span>Clear</span>
              </button>
            )}
          </div>

          <p className="tavus-loading-sub voice-hint">
            {isSupported
              ? "Choose a language, press Start, then allow microphone access."
              : "Use Chrome or Edge for voice chat."}
          </p>

          {/* Muted TTS notice */}
          {isMuted && (
            <div className="voice-muted-notice">
              <MicOff size={14} /> Speaker is muted — you will see answers but
              not hear them.
            </div>
          )}
        </div>

        {/* Conversation history */}
        {messages.length > 0 && (
          <div className="voice-history">
            <div className="voice-history-heading">Conversation</div>
            <div className="chat-stream voice-chat-stream">
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  openSource={openSource === msg.id}
                  onToggleSource={() =>
                    setOpenSource(openSource === msg.id ? null : msg.id)
                  }
                  onCopy={(text) =>
                    navigator.clipboard.writeText(text).catch(() => undefined)
                  }
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
