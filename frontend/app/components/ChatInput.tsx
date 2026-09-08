"use client";

import { ArrowUp, Mic } from "lucide-react";
import { FormEvent, useState } from "react";

type ChatInputProps = { onSubmit: (value: string) => void };
export function ChatInput({ onSubmit }: ChatInputProps) { const [value, setValue] = useState(""); const submit = (event: FormEvent) => { event.preventDefault(); if (value.trim()) { onSubmit(value.trim()); setValue(""); } }; 
return <form className="chat-input" onSubmit={submit}>
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Ask SLT-MOBITEL AI Assistant about broadband, bills, packages..." aria-label="Ask the assistant" />
          <button type="button" aria-label="Use microphone">
          <Mic size={19} /></button>
          <button className="send-button" type="submit" aria-label="Send message">
                    <ArrowUp size={18} /></button></form>; }
