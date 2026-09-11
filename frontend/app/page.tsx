"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Menu, Plus, RotateCcw, Settings, SlidersHorizontal, Trash2, X } from "lucide-react";
import { ChatInput } from "./components/ChatInput";
import { ChatWindow } from "./components/ChatWindow";
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

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<"active" | "welcome">("welcome");
  const [language, setLanguage] = useState("EN");
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const storedSessions = window.localStorage.getItem(CHAT_STORAGE_KEY);
        const restoredSessions = storedSessions ? JSON.parse(storedSessions) as ChatSession[] : [];
        const storedActiveSessionId = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
        const restoredActiveSession = Array.isArray(restoredSessions)
          ? restoredSessions.find((session) => session.id === storedActiveSessionId)
          : undefined;

        if (Array.isArray(restoredSessions)) {
          setSessions(restoredSessions);
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

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-top">
        <div className="brand"><div className="brand-mark"><Image src="/images/logo.svg" alt="SLT-MOBITEL" width={96} height={36} priority /></div><button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={19} /></button></div>
        <button className="new-chat" onClick={startNewChat}><Plus size={16} /> New Chat <kbd></kbd></button>
      </div>
      {sessions.length > 0 && <div className="recent-list">
        <div className="recent-heading"><span>Recent chats</span></div>
        {sessions.map((session) => <div className="recent-chat" key={session.id}>
          <button className="recent-chat-open" onClick={() => openSession(session)}>{session.title}</button>
          <button className="recent-chat-delete" onClick={() => deleteSession(session.id)} aria-label={`Delete ${session.title}`} title="Delete chat"><Trash2 size={15} /></button>
        </div>)}
      </div>}
      <div className="sidebar-bottom">
        <button><Settings size={17} /> Settings</button>
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
            onStartListening={startListening}
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
