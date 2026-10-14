"use client";

import { ArrowUp } from "lucide-react";
import { FormEvent, useState } from "react";

type ChatInputProps = {
  onSubmit: (value: string) => void;
};

export function ChatInput({ onSubmit }: ChatInputProps) {
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
        placeholder="Ask SLT-MOBITEL AI Assistant about broadband, bills, packages..."
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
