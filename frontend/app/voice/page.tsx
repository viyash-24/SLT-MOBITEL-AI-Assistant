"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Mic, MicOff, PhoneOff, AlertCircle, Video } from "lucide-react";
import { TavusAvatarView } from "../components/TavusAvatarView";
import { useTavusSession } from "../hooks/useTavusSession";

const LANGUAGES = [
  { code: "EN", label: "English" },
  { code: "SI", label: "සිංහල" },
  { code: "TA", label: "தமிழ்" },
] as const;

export default function VoiceAssistantPage() {
  const [language, setLanguage] = useState<"EN" | "SI" | "TA">("EN");
  const {
    tavusState, avatarStream, tavusError, isMuted,
    startTavusSession, endTavusSession, toggleMute,
  } = useTavusSession();
  const isLive = tavusState === "active";
  const isLoading = tavusState === "checking" || tavusState === "connecting";
  const isEnding = tavusState === "ending";
  const isError = tavusState === "error" || tavusState === "not_configured";
  const busy = isLive || isLoading || isEnding;
  const status = isLoading ? "Connecting…" : isEnding ? "Ending…"
    : isLive ? (isMuted ? "Microphone muted" : "Live") : isError ? "Unavailable" : "Ready to start";

  const start = () => {
    void startTavusSession({
      language,
      conversationName: "SLT-MOBITEL AI Voice Session",
      customGreeting: language === "SI"
        ? "ආයුබෝවන්! මම SLT Avatar. අද මම ඔබට කෙසේ උදව් කරන්නද?"
        : language === "TA"
          ? "வணக்கம்! நான் SLT Avatar. இன்று நான் உங்களுக்கு எவ்வாறு உதவலாம்?"
          : "Hello! I'm SLT Avatar, your SLT-MOBITEL AI assistant. How can I help you today?",
    });
  };

  return (
    <div className="live-avatar-container">
      <div className="live-avatar-ambient"><div className="ambient-glow idle" /></div>
      <header className="live-avatar-header">
        <div className="header-left">
          <Link href="/" className="back-link" aria-label="Back to Chat" onClick={() => void endTavusSession()}>
            <ArrowLeft size={18} /><span>Back to Chat</span>
          </Link>
          <div className="brand-badge">
            <Image src="/images/emblem.svg" alt="SLT-MOBITEL" width={96} height={34} />
          </div>
        </div>
        <div className="header-center">
          <div className="live-status-pill" role="status">
            <span className={`status-dot ${isLive ? "dot-emerald" : isError ? "dot-red" : "dot-amber"}`} />
            <span className="status-text">{status}</span>
          </div>
        </div>
        <div className="header-right">
          <label className="avatar-language-label">
            Language
            <select className="lang-picker-btn" value={language} disabled={busy}
              onChange={(event) => setLanguage(event.target.value as typeof language)}>
              {LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </header>
      <main className="live-avatar-stage tavus-stage-live">
        <div className="avatar-frame-wrap avatar-frame-tavus">
          <div className="avatar-identity">
            <h1>Talk to SLT Avatar</h1>
            <p>Your SLT-MOBITEL AI avatar</p>
          </div>
          {avatarStream && <TavusAvatarView stream={avatarStream} />}
          {!avatarStream && (
            <div className="tavus-loading-centered" aria-busy={isLoading || isEnding}>
              {isLoading || isEnding ? <div className="tavus-spinner" />
                : isError ? <AlertCircle size={40} /> : <Video size={40} />}
              <p>{isLoading ? "Connecting to SLT Avatar…" : isEnding ? "Ending conversation…"
                : isError ? "Live avatar unavailable" : "Start a conversation with SLT Avatar"}</p>
              <p className="tavus-loading-sub">
                {isLoading ? "Preparing your live avatar and microphone."
                  : !isError && !isEnding ? "Allow microphone access, then speak naturally. Your camera stays off." : ""}
              </p>
            </div>
          )}
          {tavusError && <div className="avatar-error-banner" role="alert"><AlertCircle size={18} /><span>{tavusError}</span></div>}
          <div className="avatar-status-caption">
            {isLive && <span>{isMuted ? "Unmute to speak to SLT Avatar." : "SLT Avatar is ready — speak naturally."}</span>}
          </div>
          <div className="controls-group">
            {!busy && <button className="control-btn mute-btn" onClick={start}>
              <Mic size={18} /><span>{isError ? "Try again" : "Start conversation"}</span>
            </button>}
            {isLive && <button className={`control-btn mute-btn ${isMuted ? "muted" : ""}`}
              onClick={() => void toggleMute()} aria-pressed={isMuted}>
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}<span>{isMuted ? "Unmute" : "Mute"}</span>
            </button>}
            {(isLive || isLoading || isEnding) && <button className="control-btn end-btn"
              disabled={isEnding} onClick={() => void endTavusSession()}>
              <PhoneOff size={18} /><span>{isLoading ? "Cancel" : "End conversation"}</span>
            </button>}
          </div>
          <p className="tavus-loading-sub">Choose your preferred language before starting a conversation.</p>
        </div>
      </main>
    </div>
  );
}
