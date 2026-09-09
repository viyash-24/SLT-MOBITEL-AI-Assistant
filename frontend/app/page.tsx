"use client";

import Image from "next/image";
import { useState } from "react";
import { Menu, Plus, RotateCcw, Settings, SlidersHorizontal, Trash2, X } from "lucide-react";
import { ChatInput } from "./components/ChatInput";
import { ChatWindow } from "./components/ChatWindow";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { sendChatMessage } from "./services/chatService";
import type { ChatMessageData } from "./types/chat";

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessageData[];
};

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<"active" | "welcome">("welcome");
  const [language, setLanguage] = useState("EN");
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sendMessage = async (content: string) => {
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
      const response = await sendChatMessage(content, messages);
      const assistantMessage: ChatMessageData = { id: `assistant-${Date.now()}`, role: "assistant", content: response.answer, time: "Now", confidence: response.confidence, sources: response.sources };
      setMessages((current) => [...current, assistantMessage]);
      setSessions((current) => current.map((session) => session.id === sessionId
        ? { ...session, messages: [...session.messages, assistantMessage] }
        : session));
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
    setMessages([]);
    setActiveSessionId(null);
    setView("welcome");
    setSidebarOpen(false);
  };

  const clearChat = () => setMessages([]);

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
        <div className="brand"><div className="brand-mark"><Image src="/images/logo.svg" alt="SLT-MOBITEL" width={22} height={22} /></div><div><strong>SLT-MOBITEL</strong><span>AI Customer Support</span></div><button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={19} /></button></div>
        <button className="new-chat" onClick={startNewChat}><Plus size={17} /> New Chat <kbd>⌘N</kbd></button>
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
        <div className="topbar-title"><button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={21} /></button><div className="header-mark"><Image src="/images/logo.svg" alt="SLT-MOBITEL" width={22} height={22} /></div><div><strong>SLT-MOBITEL AI Assistant</strong><span><i /> Online · Ready to assist</span></div></div>
        <div className="topbar-actions"><div className="language-switcher">{["EN", "සිං", "த"].map((option) => <button className={language === option ? "selected" : ""} key={option} onClick={() => setLanguage(option)}>{option}</button>)}</div><button className="clear-button" onClick={clearChat}><RotateCcw size={16} /> Clear Chat</button><button className="icon-button"><SlidersHorizontal size={19} /></button></div>
      </header>
      <main>
        <div className="session-bar"><div className="session-info"><span className="session-pill"><i />Session #SLT-8942-AI</span><span className="context-label">RAG Context: Core Broadband &amp; Roaming Catalog 2024</span></div><div className="view-switcher"><button className={view === "active" ? "selected" : ""} onClick={() => setView("active")}>Live Chat Feed</button><button className={view === "welcome" ? "selected" : ""} onClick={() => setView("welcome")}>Welcome Screen</button></div></div>
        <div className="content-column">{view === "active" ? <ChatWindow messages={messages} loading={loading} /> : <WelcomeScreen onStart={() => setView("active")} onPrompt={sendMessage} />}<div className="disclaimer">SLT-MOBITEL AI Assistant retrieves answers exclusively from official verified engineering &amp; billing documentation. For critical network emergencies, call <b>1212</b>.</div></div>
      </main>
      <div className="composer-wrap"><ChatInput onSubmit={sendMessage} /></div>
    </section>
  </div>;
}
