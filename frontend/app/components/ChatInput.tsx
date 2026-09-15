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
