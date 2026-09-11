"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Menu, Moon, Plus, RotateCcw, Settings, Sun, Trash2, X } from "lucide-react";
import { ChatInput } from "./components/ChatInput";
import { ChatWindow } from "./components/ChatWindow";
import { VoiceAgentPage } from "./components/VoiceAgentPage";
import { VoiceChatButton } from "./components/VoiceChatButton";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { useVoiceChat } from "./hooks/useVoiceChat";
import { sendChatMessage } from "./services/chatService";
import type { ChatMessageData } from "./types/chat";

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessageData[];
};

const CHAT_STORAGE_KEY = "slt-mobitel-chat-sessions";
const ACTIVE_SESSION_STORAGE_KEY = "slt-mobitel-active-session";
const THEME_STORAGE_KEY = "slt-mobitel-theme";

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<"active" | "welcome" | "voice">("welcome");
  const [language, setLanguage] = useState("EN");
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // Apply dark mode class to document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const storedSessions = window.localStorage.getItem(CHAT_STORAGE_KEY);
        const restoredSessions = storedSessions ? JSON.parse(storedSessions) as ChatSession[] : [];

        if (Array.isArray(restoredSessions)) {
          setSessions(restoredSessions);
        }
        // Restore theme preference
        const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === "dark") {
          setDarkMode(true);
        }
        // Always show the welcome screen initially on site load / reload
        setView("welcome");
        setActiveSessionId(null);
        setMessages([]);
      } catch {
        window.localStorage.removeItem(CHAT_STORAGE_KEY);
        window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      } finally {
        setStorageReady(true);
      }
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(sessions));
    if (activeSessionId) {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
    } else {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    }
  }, [activeSessionId, sessions, storageReady]);

  const toggleDarkMode = (enable: boolean) => {
    setDarkMode(enable);
    window.localStorage.setItem(THEME_STORAGE_KEY, enable ? "dark" : "light");
  };

  const {
    isSupported,
    isListening,
    isSpeaking,
    speakingMessageId,
    transcript,
    interimTranscript,
    voiceError,
    startListening,
    stopListening,
    cancelListening,
    speak,
    stopSpeaking,
    clearVoiceError,
  } = useVoiceChat({
    language,
    onTranscriptComplete: (recognizedText) => {
      if (recognizedText.trim()) {
        sendMessage(recognizedText.trim(), { isVoice: true });
      }
    },
  });

  const sendMessage = async (content: string, options?: { isVoice?: boolean }) => {
    stopSpeaking();
    setView("active");
    const userMessage: ChatMessageData = { id: `user-${Date.now()}`, role: "user", content, time: "Now" };
    const sessionId = activeSessionId ?? `session-${Date.now()}`;
    if (!activeSessionId) {
      setActiveSessionId(sessionId);
    }
    setMessages((current) => [...current, userMessage]);
    setSessions((current) => {
      const existing = current.find((session) => session.id === sessionId);
      if (existing) {
        return current.map((session) => session.id === sessionId
          ? { ...session, messages: [...session.messages, userMessage] }
          : session);
      }
      return [{ id: sessionId, title: content, messages: [userMessage] }, ...current];
    });
    setLoading(true);
    try {
      const response = await sendChatMessage(content, messages, sessionId);
      const assistantMessage: ChatMessageData = { id: `assistant-${Date.now()}`, role: "assistant", content: response.answer, time: "Now", confidence: response.confidence, sources: response.sources };
      setMessages((current) => [...current, assistantMessage]);
      setSessions((current) => current.map((session) => session.id === sessionId
        ? { ...session, messages: [...session.messages, assistantMessage] }
        : session));
      if (options?.isVoice) {
        speak(response.answer, assistantMessage.id);
      }
    } catch (error) {
      const errorMessage: ChatMessageData = { id: `error-${Date.now()}`, role: "assistant", content: error instanceof Error ? error.message : "The assistant is temporarily unavailable.", time: "Now" };
      setMessages((current) => [...current, errorMessage]);
      setSessions((current) => current.map((session) => session.id === sessionId
        ? { ...session, messages: [...session.messages, errorMessage] }
        : session));
    } finally {
      setLoading(false);
    }
  };

  const startNewChat = () => {
    stopSpeaking();
    cancelListening();
    setMessages([]);
    setActiveSessionId(null);
    setView("welcome");
    setSidebarOpen(false);
  };

  const clearChat = () => {
    stopSpeaking();
    cancelListening();
    setMessages([]);
    setActiveSessionId(null);
    setView("welcome");
  };

  const openSession = (session: ChatSession) => {
    setMessages(session.messages);
    setActiveSessionId(session.id);
    setView("active");
    setSidebarOpen(false);
  };

  const deleteSession = (sessionId: string) => {
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    if (activeSessionId === sessionId) {
      setMessages([]);
      setActiveSessionId(null);
      setView("welcome");
    }
  };

  const openVoiceAgent = () => {
    stopSpeaking();
    setView("voice");
    setSidebarOpen(false);
  };

  const closeVoiceAgent = () => {
    cancelListening();
    stopSpeaking();
    setView("active");
  };

  // If voice agent page is open, render it full-workspace
  if (view === "voice") {
    return (
      <div className="app-shell">
        <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
          <div className="sidebar-top">
            <div className="brand"><div className="brand-mark"><Image src="/images/logo.svg" alt="SLT-MOBITEL" width={86} height={32} priority /></div><button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={19} /></button></div>
            <button className="new-chat" onClick={startNewChat}><Plus size={14} /> New Chat</button>
          </div>
          {sessions.length > 0 && <div className="recent-list">
            <div className="recent-heading"><span>Recent chats</span></div>
            {sessions.map((session) => <div className="recent-chat" key={session.id}>
              <button className="recent-chat-open" onClick={() => openSession(session)}>{session.title}</button>
              <button className="recent-chat-delete" onClick={() => deleteSession(session.id)} aria-label={`Delete ${session.title}`} title="Delete chat"><Trash2 size={15} /></button>
            </div>)}
          </div>}
          <div className="sidebar-bottom">
            <button onClick={() => setSettingsOpen(!settingsOpen)}><Settings size={17} /> Settings</button>
            {settingsOpen && (
              <div className="settings-panel">
                <div className="settings-label">THEME</div>
                <div className="theme-toggle">
                  <button
                    className={!darkMode ? "theme-btn active" : "theme-btn"}
                    onClick={() => toggleDarkMode(false)}
                  >
                    <Sun size={14} /> Light
                  </button>
                  <button
                    className={darkMode ? "theme-btn active" : "theme-btn"}
                    onClick={() => toggleDarkMode(true)}
                  >
                    <Moon size={14} /> Dark
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
        <div className="scrim" onClick={() => setSidebarOpen(false)} />
        <section className="workspace">
          <VoiceAgentPage
            isListening={isListening}
            isSpeaking={isSpeaking}
            transcript={transcript}
            interimTranscript={interimTranscript}
            voiceError={voiceError}
            isSupported={isSupported}
            onStartListening={startListening}
            onStopListening={stopListening}
            onCancelListening={cancelListening}
            onStopSpeaking={stopSpeaking}
            onBackToChat={closeVoiceAgent}
          />
        </section>
      </div>
    );
  }

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-top">
        <div className="brand"><div className="brand-mark"><Image src="/images/logo.svg" alt="SLT-MOBITEL" width={86} height={32} priority /></div><button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={19} /></button></div>
        <button className="new-chat" onClick={startNewChat}><Plus size={14} /> New Chat</button>
      </div>
      {sessions.length > 0 && <div className="recent-list">
        <div className="recent-heading"><span>Recent chats</span></div>
        {sessions.map((session) => <div className="recent-chat" key={session.id}>
          <button className="recent-chat-open" onClick={() => openSession(session)}>{session.title}</button>
          <button className="recent-chat-delete" onClick={() => deleteSession(session.id)} aria-label={`Delete ${session.title}`} title="Delete chat"><Trash2 size={15} /></button>
        </div>)}
      </div>}
      <div className="sidebar-bottom">
        <button onClick={() => setSettingsOpen(!settingsOpen)}><Settings size={17} /> Settings</button>
        {settingsOpen && (
          <div className="settings-panel">
            <div className="settings-label">THEME</div>
            <div className="theme-toggle">
              <button
                className={!darkMode ? "theme-btn active" : "theme-btn"}
                onClick={() => toggleDarkMode(false)}
              >
                <Sun size={14} /> Light
              </button>
              <button
                className={darkMode ? "theme-btn active" : "theme-btn"}
                onClick={() => toggleDarkMode(true)}
              >
                <Moon size={14} /> Dark
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
    <div className="scrim" onClick={() => setSidebarOpen(false)} />
    <section className="workspace">
      <header className="topbar">
        <div className="topbar-title">
          <button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={21} /></button>          
          <div>
            <strong>SLT-MOBITEL AI Assistant</strong>
            <span><i /> Online · Ready to assist</span>
          </div>
        </div>
        <div className="topbar-actions">
          <VoiceChatButton
            isListening={isListening}
            isSpeaking={isSpeaking}
            transcript={transcript}
            interimTranscript={interimTranscript}
            voiceError={voiceError}
            onStartListening={openVoiceAgent}
            onStopListening={stopListening}
            onCancelListening={cancelListening}
            onStopSpeaking={stopSpeaking}
            onClearError={clearVoiceError}
            isSupported={isSupported}
          />
          {view === "active" && messages.length > 0 && (
            <button className="clear-button" onClick={clearChat} title="Clear current chat">
              <RotateCcw size={16} /> Clear Chat
            </button>
          )}
        </div>
      </header>
      <main>
        <div className="session-bar"><div className="session-info"></div><div className="view-switcher"><button className={view === "welcome" ? "selected" : ""} onClick={() => setView("welcome")}>Welcome Screen</button><button className={view === "active" ? "selected" : ""} onClick={() => setView("active")}>Live Chat Feed</button></div></div>
        <div className="content-column">
          {view === "active" ? (
            <ChatWindow
              messages={messages}
              loading={loading}
              speakingMessageId={speakingMessageId}
              onSpeakMessage={(text, messageId) => speak(text, messageId)}
              onStopSpeaking={stopSpeaking}
            />
          ) : (
            <WelcomeScreen onStart={() => setView("active")} onPrompt={sendMessage} />
          )}
          <div className="disclaimer">SLT-MOBITEL AI Assistant retrieves answers exclusively from official verified engineering &amp; billing documentation. For critical network emergencies, call <b>1212</b>.</div>
        </div>
      </main>
      <div className="composer-wrap">
        <ChatInput
          onSubmit={sendMessage}
          isListening={isListening}
          onToggleVoice={() => {
            if (isListening) {
              stopListening();
            } else {
              startListening();
            }
          }}
        />
      </div>
    </section>
  </div>;
}

