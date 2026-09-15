"use client";

import { ArrowUp, Mic } from "lucide-react";
import { FormEvent, useState } from "react";

type ChatInputProps = {
  onSubmit: (value: string) => void;
  isListening?: boolean;
  onToggleVoice?: () => void;
};

export function ChatInput({ onSubmit, isListening, onToggleVoice }: ChatInputProps) {
  const [value, setValue] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim());
      setValue("");
    }
  };

  const hasText = value.trim().length > 0;

  return (
    <form className="chat-input" onSubmit={submit}>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={isListening ? "Listening to your voice..." : "Ask SLT-MOBITEL AI Assistant about broadband, bills, packages..."}
        aria-label="Ask the assistant"
      />
      
      <button
        className={`send-button ${hasText ? "active" : "inactive"}`}
        type="submit"
        disabled={!hasText}
        aria-label="Send message"
        title={hasText ? "Send message" : "Type a message to send"}
      >
        <ArrowUp size={18} />
      </button>
    </form>
  );
}
