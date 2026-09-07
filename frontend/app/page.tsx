"use client";

import { useState } from "react";
import { Menu, Plus, RotateCcw, Settings, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { ChatInput } from "./components/ChatInput";
import { ChatWindow } from "./components/ChatWindow";
import { WelcomeScreen } from "./components/WelcomeScreen";
import type { ChatMessageData } from "./types/chat";

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<"active" | "welcome">("active");
  const [language, setLanguage] = useState("EN");
  const [messages, setMessages] = useState<ChatMessageData[]>([]);

  const sendMessage = (content: string) => {
    setView("active");
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", content, time: "Now" }]);
  };

  const clearChat = () => setMessages([]);

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-top">
        <div className="brand"><div className="brand-mark"><Sparkles size={18} /></div><div><strong>SLT-MOBITEL</strong><span>AI Customer Support</span></div><button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={19} /></button></div>
        <button className="new-chat" onClick={() => { clearChat(); setView("welcome"); setSidebarOpen(false); }}><Plus size={17} /> New Chat <kbd>⌘N</kbd></button>
      </div>
      <div className="sidebar-bottom">
        <button><Settings size={17} /> Settings</button>
      </div>
    </aside>
    <div className="scrim" onClick={() => setSidebarOpen(false)} />
    <section className="workspace">
      <header className="topbar">
        <div className="topbar-title"><button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={21} /></button><div className="header-mark"><Sparkles size={17} /></div><div><strong>SLT-MOBITEL AI Assistant</strong><span><i /> Online · Ready to assist</span></div></div>
        <div className="topbar-actions"><div className="language-switcher">{["EN", "සිං", "த"].map((option) => <button className={language === option ? "selected" : ""} key={option} onClick={() => setLanguage(option)}>{option}</button>)}</div><button className="clear-button" onClick={clearChat}><RotateCcw size={16} /> Clear Chat</button><button className="icon-button"><SlidersHorizontal size={19} /></button></div>
      </header>
      <main>
        <div className="session-bar"><div className="session-info"><span className="session-pill"><i />Session #SLT-8942-AI</span><span className="context-label">RAG Context: Core Broadband &amp; Roaming Catalog 2024</span></div><div className="view-switcher"><button className={view === "active" ? "selected" : ""} onClick={() => setView("active")}>Live Chat Feed</button><button className={view === "welcome" ? "selected" : ""} onClick={() => setView("welcome")}>Welcome Screen</button></div></div>
        <div className="content-column">{view === "active" ? <ChatWindow messages={messages} onCopy={() => undefined} /> : <WelcomeScreen onStart={() => setView("active")} onPrompt={sendMessage} />}<div className="disclaimer">SLT-MOBITEL AI Assistant retrieves answers exclusively from official verified engineering &amp; billing documentation. For critical network emergencies, call <b>1212</b>.</div></div>
      </main>
      <div className="composer-wrap"><ChatInput onSubmit={sendMessage} /></div>
    </section>
  </div>;
}
