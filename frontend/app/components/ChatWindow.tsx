"use client";

import { useState } from "react";
import { ChatMessage } from "./ChatMessage";
import { LoadingMessage } from "./LoadingMessage";
import type { ChatMessageData } from "../types/chat";

type ChatWindowProps = {
  messages: ChatMessageData[];
  loading: boolean;
};

export function ChatWindow({ messages, loading }: ChatWindowProps) {
  const [openSource, setOpenSource] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="chat-stream">
      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          openSource={openSource === message.id}
          onToggleSource={() => setOpenSource(openSource === message.id ? null : message.id)}
          onCopy={handleCopy}
        />
      ))}
      {copied && <span className="copy-note">Response copied</span>}
      {loading && <LoadingMessage />}
    </div>
  );
}

