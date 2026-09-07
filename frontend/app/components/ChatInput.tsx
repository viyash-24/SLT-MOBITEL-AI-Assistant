import { ArrowUp, Mic } from "lucide-react";
import { FormEvent, useState } from "react";

type ChatInputProps = { onSubmit: (value: string) => void };
export function ChatInput({ onSubmit }: ChatInputProps) { const [value, setValue] = useState(""); const submit = (event: FormEvent) => { event.preventDefault(); if (value.trim()) { onSubmit(value.trim()); setValue(""); } }; 
