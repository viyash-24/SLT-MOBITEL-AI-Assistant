"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Globe,
  Mic,
  MicOff,
  PhoneOff,
  Sparkles,
  Volume2,
  VolumeX,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { useLiveVoiceSession } from "../hooks/useLiveVoiceSession";

const LANGUAGES = [
  { code: "EN", label: "English", native: "English" },
  { code: "SI", label: "Sinhala", native: "සිංහල" },
  { code: "TA", label: "Tamil", native: "தமிழ்" },
];

export default function LiveAvatarVoicePage() {
  const [selectedLanguage, setSelectedLanguage] = useState("EN");
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const {
    state,
    statusMessage,
    errorMessage,
    isMuted,
    assistantTranscript,
    sources,
    audioLevel,
    startSession,
    endSession,
    toggleMute,
  } = useLiveVoiceSession({
    language: selectedLanguage,
  });

  // Automatically start the live voice session upon landing on /voice
  useEffect(() => {
    const timer = setTimeout(() => {
      startSession();
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLanguageChange = (langCode: string) => {
    setSelectedLanguage(langCode);
    setLangMenuOpen(false);
    // Restart session with the new language prompt
    if (state !== "idle" && state !== "connecting") {
      setTimeout(() => {
        startSession();
      }, 100);
    }
  };

  const getStatusBadge = () => {
    switch (state) {
      case "connecting":
        return { label: "Connecting...", dotClass: "dot-amber", text: "Connecting" };
      case "listening":
        return { label: isMuted ? "Microphone Muted" : "Listening...", dotClass: isMuted ? "dot-amber" : "dot-cyan", text: isMuted ? "Muted" : "Listening" };
      case "thinking":
        return { label: "Searching Knowledge Base...", dotClass: "dot-purple", text: "Thinking" };
      case "speaking":
        return { label: "Speaking...", dotClass: "dot-emerald", text: "Speaking" };
      case "error":
        return { label: "Connection Error", dotClass: "dot-red", text: "Error" };
      default:
        return { label: "Ready to Connect", dotClass: "dot-gray", text: "Idle" };
    }
  };

  const statusBadge = getStatusBadge();

  return (
    <div className="live-avatar-container">
      {/* Background ambient lighting */}
      <div className="live-avatar-ambient">
        <div className={`ambient-glow ${state}`} />
      </div>

      {/* Top Header */}
      <header className="live-avatar-header">
        <div className="header-left">
          <Link href="/" className="back-link" onClick={endSession}>
            <ArrowLeft size={18} />
            <span>Back to Chat</span>
          </Link>
          <div className="brand-badge">
            <Image src="/images/logo.svg" alt="SLT-MOBITEL" width={96} height={34} priority />
          </div>
        </div>

        <div className="header-center">
          <div className="live-status-pill">
            <span className={`status-dot ${statusBadge.dotClass}`} />
            <span className="status-text">{statusBadge.text}</span>
          </div>
        </div>

        <div className="header-right">
          {/* Language Selector */}
          <div className="lang-picker-wrapper">
            <button
              type="button"
              className="lang-picker-btn"
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              title="Select Conversation Language"
              aria-label="Select Language"
            >
              <Globe size={15} />
              <span>{LANGUAGES.find((l) => l.code === selectedLanguage)?.native || "English"}</span>
            </button>
            {langMenuOpen && (
              <div className="lang-dropdown">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    className={`lang-option ${selectedLanguage === lang.code ? "active" : ""}`}
                    onClick={() => handleLanguageChange(lang.code)}
                  >
                    <span className="lang-native">{lang.native}</span>
                    <span className="lang-name">({lang.label})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Avatar Stage */}
      <main className="live-avatar-stage">
        {/* Avatar Representation */}
        <div className="avatar-frame-wrap">
          <div className={`avatar-aura-ring aura-${state}`}>
            {/* Pulsing visual energy rings */}
            <div className="aura-pulse-1" style={{ transform: `scale(${1 + audioLevel * 0.25})` }} />
            <div className="aura-pulse-2" style={{ transform: `scale(${1 + audioLevel * 0.45})` }} />

            <div className="avatar-image-container">
              <Image
                src="/images/avatar.jpg"
                alt="Alt - SLT-MOBITEL AI Virtual Assistant"
                width={320}
                height={320}
                className={`avatar-portrait ${state === "speaking" ? "speaking-anim" : ""}`}
                priority
              />

              {/* Holographic state overlay badge */}
              <div className={`avatar-state-indicator state-${state}`}>
                {state === "speaking" ? (
                  <Volume2 size={16} className="state-icon-pulse" />
                ) : state === "thinking" ? (
                  <Sparkles size={16} className="state-icon-spin" />
                ) : state === "listening" ? (
                  isMuted ? <MicOff size={16} /> : <Mic size={16} className="state-icon-pulse" />
                ) : (
                  <VolumeX size={16} />
                )}
              </div>
            </div>
          </div>

          {/* Representative Identity & Title */}
          <div className="avatar-identity">
            <h2>voice agent</h2>
            <p>SLT-MOBITEL AI Customer Care Assistant</p>
          </div>

          {/* Soundwave audio visualizer bar */}
          <div className={`soundwave-bar ${state}`}>
            <span style={{ height: `${Math.max(12, audioLevel * 60)}px` }} />
            <span style={{ height: `${Math.max(16, audioLevel * 85)}px` }} />
            <span style={{ height: `${Math.max(22, audioLevel * 100)}px` }} />
            <span style={{ height: `${Math.max(18, audioLevel * 75)}px` }} />
            <span style={{ height: `${Math.max(14, audioLevel * 50)}px` }} />
          </div>

          {/* Dynamic Status Message */}
          <div className="avatar-status-caption">
            <span>{statusMessage}</span>
          </div>

          {/* Error Message Toast */}
          {errorMessage && (
            <div className="avatar-error-banner">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
              <button onClick={startSession} className="retry-btn">
                <RotateCcw size={14} /> Retry
              </button>
            </div>
          )}

          {/* Live Subtitle Transcript Banner */}
          {assistantTranscript && (
            <div className="live-transcript-card">
              <div className="transcript-speaker">
                <span className="speaker-name">Voice Agent:</span>
              </div>
              <div className="transcript-text">
                <p>{assistantTranscript}</p>
              </div>
              {sources.length > 0 && (
                <div className="transcript-sources">
                  <span className="sources-label">Verified Knowledge:</span>
                  {sources.map((src, idx) => (
                    <span key={idx} className="source-tag">
                      {src.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Bottom Controls Bar */}
      <footer className="live-avatar-footer">
        <div className="controls-group">
          {/* Mute/Unmute Button */}
          <button
            type="button"
            className={`control-btn mute-btn ${isMuted ? "muted" : ""}`}
            onClick={toggleMute}
            disabled={state === "idle" || state === "connecting"}
            title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            aria-label={isMuted ? "Unmute Microphone" : "Mute Microphone"}
          >
            {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            <span>{isMuted ? "Unmute" : "Mute"}</span>
          </button>

          {/* Main Action / Reconnect Button */}
          {state === "idle" || state === "error" ? (
            <button
              type="button"
              className="control-btn primary-start-btn"
              onClick={startSession}
              title="Start Voice Conversation"
            >
              <Mic size={24} />
              <span>Start Conversation</span>
            </button>
          ) : (
            /* End Conversation Button */
            <Link href="/" onClick={endSession} className="control-btn end-btn" title="End conversation and return to chat">
              <PhoneOff size={22} />
              <span>End Conversation</span>
            </Link>
          )}
        </div>
      </footer>
    </div>
  );
}
