"use client";

/**
 * VoiceAssistantPage — SLT-MOBITEL AI Assistant (Tavus-Only Mode)
 *
 * This page uses the Tavus CVI (Conversational Video Interface) as the SOLE
 * AI assistant. The Tavus avatar handles everything internally:
 *   - Microphone input (STT)
 *   - AI reasoning (via the configured Tavus persona / replica)
 *   - Text-to-speech synthesis
 *   - Real-time lip-sync and facial animation
 *
 * The Gemini Live voice session is NOT used here — it was causing a "dual AI"
 * problem where both Gemini and Tavus would speak at the same time.
 *
 * When Tavus is not configured or credits are exhausted, the page shows a
 * clear "unavailable" state rather than silently falling back to a broken
 * experience.
 */

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
  Video,
} from "lucide-react";
import { useTavusSession } from "../hooks/useTavusSession";

const LANGUAGES = [
  { code: "EN", label: "English", native: "English" },
  { code: "SI", label: "Sinhala", native: "සිංහල" },
  { code: "TA", label: "Tamil", native: "தமிழ்" },
];

/** Map Tavus session state to a UI badge */
function getStatusBadge(tavusState: string, isMuted: boolean) {
  switch (tavusState) {
    case "checking":
    case "connecting":
      return { dotClass: "dot-amber", text: "Connecting Avatar…" };
    case "active":
      return {
        dotClass: isMuted ? "dot-amber" : "dot-emerald",
        text: isMuted ? "Muted" : "Live",
      };
    case "ending":
      return { dotClass: "dot-gray", text: "Ending…" };
    case "not_configured":
      return { dotClass: "dot-red", text: "Not Configured" };
    case "error":
      return { dotClass: "dot-red", text: "Error" };
    default:
      return { dotClass: "dot-gray", text: "Idle" };
  }
}

export default function VoiceAssistantPage() {
  const [selectedLanguage, setSelectedLanguage] = useState("EN");
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  /**
   * isMuted mirrors the Tavus iframe's mic state.
   * We pass this hint to the iframe via postMessage so the Tavus Daily.co
   * room can mute/unmute the local participant's microphone track.
   */
  const [isMuted, setIsMuted] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // ── Tavus CVI session ────────────────────────────────────────────────────
  const {
    tavusState,
    conversationUrl,
    tavusError,
    isConfigured: tavusConfigured,
    startTavusSession,
    endTavusSession,
  } = useTavusSession();

  // Start Tavus on mount; end it on unmount
  useEffect(() => {
    startTavusSession({
      conversationalContext:
        "You are Kasuni, a friendly and professional SLT-MOBITEL AI customer care representative. " +
        "Help customers with their telecom queries about broadband, mobile, fiber, and SLT-MOBITEL services. " +
        "Be warm, concise, and always polite. " +
        "When a customer changes language mid-conversation, switch to that language naturally.",
      customGreeting:
        selectedLanguage === "SI"
          ? "ආයුබෝවන්! SLT-MOBITEL AI සේවාවට සාදරයෙන් පිළිගනිමු. මම කසුනි. අද මම ඔබට කෙසේ උදව් කරන්නද?"
          : selectedLanguage === "TA"
          ? "வணக்கம்! SLT-MOBITEL AI-க்கு வரவேற்கிறோம். நான் கசுனி. இன்று நான் உங்களுக்கு எவ்வாறு உதவலாம்?"
          : "Hello! Welcome to SLT-MOBITEL AI. I'm Kasuni, your customer care assistant. How can I help you today?",
      conversationName: "SLT-MOBITEL AI Voice Session",
    });

    return () => {
      endTavusSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mute / unmute via Daily.co postMessage ────────────────────────────────
  // The Tavus iframe is a Daily.co room. Daily supports postMessage commands
  // to mute/unmute the local participant without reloading the iframe.
  const applyMuteToIframe = (muted: boolean) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !conversationUrl) return;
    try {
      iframe.contentWindow.postMessage(
        { action: muted ? "disable-local-audio" : "enable-local-audio" },
        new URL(conversationUrl).origin
      );
    } catch {
      /* cross-origin restriction — mute state is visual only */
    }
  };

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    applyMuteToIframe(next);
  };

  const handleStop = () => {
    endTavusSession();
  };

  const handleLanguageChange = (langCode: string) => {
    setSelectedLanguage(langCode);
    setLangMenuOpen(false);
  };

  const handleRetry = () => {
    startTavusSession({
      conversationalContext:
        "You are Kasuni, a friendly and professional SLT-MOBITEL AI customer care representative.",
      conversationName: "SLT-MOBITEL AI Voice Session",
    });
  };

  const statusBadge = getStatusBadge(tavusState, isMuted);
  const isLive = tavusState === "active" && Boolean(conversationUrl);
  const isLoading = tavusState === "checking" || tavusState === "connecting";
  const isError = tavusState === "error" || tavusState === "not_configured";

  return (
    <div className="live-avatar-container">
      {/* Background ambient lighting */}
      <div className="live-avatar-ambient">
        <div className={`ambient-glow ${isLive ? "speaking" : "idle"}`} />
      </div>

      {/* Top Header */}
      <header className="live-avatar-header">
        <div className="header-left">
          <Link href="/" className="back-link" onClick={handleStop}>
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
          {/* Tavus configured indicator */}
          {tavusConfigured && (
            <div className="tavus-toggle-btn tavus-on" title="Tavus Live Avatar Active">
              <Video size={15} />
              <span>Live Avatar</span>
            </div>
          )}

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

      {/* Main Avatar Stage — full-screen Tavus CVI */}
      <main className={`live-avatar-stage ${isLive ? "tavus-stage-live" : ""}`}>
        <div className={`avatar-frame-wrap ${isLive ? "avatar-frame-tavus" : ""}`}>

          {/* ── LIVE: Tavus CVI iframe fills the entire stage ── */}
          {isLive && (
            <div className="tavus-iframe-shell tavus-iframe-fullscreen">
              <iframe
                ref={iframeRef}
                src={conversationUrl!}
                allow="camera; microphone; fullscreen; display-capture; autoplay; encrypted-media"
                allowFullScreen
                className="tavus-live-iframe tavus-iframe-visible"
                title="Kasuni — SLT-MOBITEL AI Avatar"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
              />
            </div>
          )}

          {/* ── LOADING: spinner while Tavus session is being created ── */}
          {isLoading && (
            <div className="tavus-iframe-loading tavus-loading-centered">
              <div className="tavus-spinner" />
              <p>Connecting to Kasuni…</p>
              <p className="tavus-loading-sub">Preparing your AI avatar — this takes a moment</p>
            </div>
          )}

          {/* ── ERROR / NOT CONFIGURED: clear message ── */}
          {isError && (
            <div className="tavus-iframe-loading tavus-loading-centered">
              <AlertCircle size={40} style={{ color: "var(--color-red, #ef4444)", marginBottom: "12px" }} />
              <p style={{ fontWeight: 600 }}>
                {tavusState === "not_configured"
                  ? "Live Avatar Unavailable"
                  : "Connection Failed"}
              </p>
              <p className="tavus-loading-sub">
                {tavusError ||
                  (tavusState === "not_configured"
                    ? "The Tavus API key is not configured. Please contact your administrator."
                    : "Could not connect to the Tavus avatar service.")}
              </p>
              {tavusState !== "not_configured" && (
                <button className="retry-btn" style={{ marginTop: 16 }} onClick={handleRetry}>
                  <RotateCcw size={14} /> Retry
                </button>
              )}
            </div>
          )}

          {/* Avatar identity caption — shown only during load / idle states */}
          {!isLive && !isError && (
            <div className="avatar-identity" style={{ marginTop: isLoading ? 0 : undefined }}>
              {!isLoading && (
                <>
                  <h2>SLT-MOBITEL AI Voice Assistant</h2>
                  <p>Powered by Kasuni — your AI customer care avatar</p>
                </>
              )}
            </div>
          )}

          {/* Status caption shown during connecting / active */}
          <div className="avatar-status-caption">
            <span>
              {isLoading
                ? "Connecting to Kasuni live avatar…"
                : isLive
                ? "Kasuni is ready — speak naturally"
                : ""}
            </span>
          </div>

          {/* ── Controls ── */}
          <div className="controls-group">
            {/* Mute / Unmute — only relevant when Tavus is active */}
            {isLive && (
              <button
                type="button"
                className={`control-btn mute-btn ${isMuted ? "muted" : ""}`}
                onClick={handleToggleMute}
                title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                aria-label={isMuted ? "Unmute Microphone" : "Mute Microphone"}
              >
                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                <span>{isMuted ? "Unmute" : "Mute"}</span>
              </button>
            )}

            {/* Stop / Exit */}
            <Link
              href="/"
              onClick={handleStop}
              className="control-btn end-btn"
              title="End conversation and return to chat"
              aria-label="Stop Conversation"
            >
              <PhoneOff size={18} />
              <span>{isLive || isLoading ? "Stop" : "Exit"}</span>
            </Link>
          </div>

          {/* Error banner (non-fatal, e.g. credit exhaustion after session starts) */}
          {tavusError && !isError && (
            <div className="avatar-error-banner tavus-warn-banner">
              <AlertCircle size={16} />
              <span>{tavusError}</span>
              <button onClick={handleRetry} className="retry-btn">
                <RotateCcw size={14} /> Retry
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Footer spacing */}
      <footer className="live-avatar-footer" />
    </div>
  );
}
