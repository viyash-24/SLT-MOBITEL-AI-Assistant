"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Globe,
  Mic,
  MicOff,
  PhoneOff,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { useVoiceSession } from "../hooks/useVoiceSession";
import { AvatarView } from "../components/AvatarView";


const LANGUAGES = [
  { code: "EN", label: "English", native: "English" },
  { code: "SI", label: "Sinhala", native: "සිංහල" },
  { code: "TA", label: "Tamil", native: "தமிழ்" },
];

export default function VoiceAssistantPage() {
  const [selectedLanguage, setSelectedLanguage] = useState("EN");
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const {
    state,
    statusMessage,
    errorMessage,
    isMuted,
    userTranscript,
    assistantTranscript,
    audioLevel,
    startSession,
    endSession,
    toggleMute,
  } = useVoiceSession({
    language: selectedLanguage,
  });

  // Automatically start voice session on mount
  useEffect(() => {
    startSession();
    return () => {
      endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restart session when language changes
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    // Restart whenever the session is active OR in error state (user changed lang to retry).
    if (state !== "idle" && state !== "connecting") {
      startSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLanguage]);

  const handleLanguageChange = (langCode: string) => {
    setSelectedLanguage(langCode);
    setLangMenuOpen(false);
  };

  const getStatusBadge = () => {
    switch (state) {
      case "connecting":
        return { dotClass: "dot-amber", text: "Connecting" };
      case "listening":
        return { dotClass: isMuted ? "dot-amber" : "dot-cyan", text: isMuted ? "Muted" : "Listening" };
      case "thinking":
        return { dotClass: "dot-purple", text: "Thinking" };
      case "speaking":
        return { dotClass: "dot-emerald", text: "Speaking" };
      case "error":
        return { dotClass: "dot-red", text: "Error" };
      default:
        return { dotClass: "dot-gray", text: "Idle" };
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
            <Image
              src="/images/emblem.svg"
              alt="SLT-MOBITEL"
              width={96}
              height={34}
              style={{ width: "auto", height: "auto" }}
              
            />
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
        <div className="avatar-frame-wrap">
          {/* Avatar with dynamic aura and state indicator */}
          <AvatarView state={state} audioLevel={audioLevel} isMuted={isMuted} />

          {/* Representative Identity & Title */}
          <div className="avatar-identity">
            <h2>SLT-MOBITEL AI Voice Assistant</h2>
            <p>Customer Care Real-Time Voice</p>
          </div>

          {/* Soundwave audio visualizer bar */}
          <div className={`soundwave-bar ${state}`}>
            <span style={{ height: `${Math.max(10, audioLevel * 55)}px` }} />
            <span style={{ height: `${Math.max(14, audioLevel * 80)}px` }} />
            <span style={{ height: `${Math.max(20, audioLevel * 100)}px` }} />
            <span style={{ height: `${Math.max(16, audioLevel * 70)}px` }} />
            <span style={{ height: `${Math.max(12, audioLevel * 45)}px` }} />
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

          {/* Real-time User Transcript (while user is speaking) */}
          {userTranscript && (
            <div className="live-transcript-card" style={{ marginBottom: "12px", borderColor: "rgba(56, 189, 248, 0.4)" }}>
              <div className="transcript-speaker">
                <span className="speaker-name" style={{ color: "#38bdf8" }}>You:</span>
              </div>
              <div className="transcript-text">
                <p>{userTranscript}</p>
              </div>
            </div>
          )}

          {/* Assistant Response Subtitle Transcript Card */}
          {assistantTranscript && (
            <div className="live-transcript-card">
              <div className="transcript-speaker">
                <span className="speaker-name">Agent:</span>
              </div>
              <div className="transcript-text">
                <p>{assistantTranscript}</p>
              </div>
              
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
            <Link
              href="/"
              onClick={endSession}
              className="control-btn end-btn"
              title="End conversation and return to chat"
            >
              <PhoneOff size={22} />
              <span>End Conversation</span>
            </Link>
          )}
        </div>
      </footer>
    </div>
  );
}
