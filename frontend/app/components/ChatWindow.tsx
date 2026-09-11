"use client";

import { useState } from "react";
import { ChatMessage } from "./ChatMessage";
import { LoadingMessage } from "./LoadingMessage";
import type { ChatMessageData } from "../types/chat";

type ChatWindowProps = {
  messages: ChatMessageData[];
  loading: boolean;
  speakingMessageId?: string | null;
  onSpeakMessage?: (text: string, messageId: string) => void;
  onStopSpeaking?: () => void;
};

export function ChatWindow({
  messages,
  loading,
  speakingMessageId,
  onSpeakMessage,
  onStopSpeaking,
}: ChatWindowProps) {
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
          isSpeaking={speakingMessageId === message.id}
          onSpeak={(text) => onSpeakMessage?.(text, message.id)}
          onStopSpeak={onStopSpeaking}
        />
      ))}
      {copied && <span className="copy-note">Response copied</span>}
      {loading && <LoadingMessage />}
    </div>
  );
}

