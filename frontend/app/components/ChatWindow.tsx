import { useState } from "react";
import { ChatMessage } from "./ChatMessage";
import { LoadingMessage } from "./LoadingMessage";
import type { ChatMessageData } from "../types/chat";
type ChatWindowProps = { messages: ChatMessageData[]; onCopy: () => void };
export function ChatWindow({ messages, onCopy }: ChatWindowProps) { const [openSource, setOpenSource] = useState<string | null>(null); const [copied, setCopied] = useState(false); return <div className="chat-stream">{messages.map((message) => <ChatMessage key={message.id} message={message} openSource={openSource === message.id} onToggleSource={() => setOpenSource(openSource === message.id ? null : message.id)} onCopy={() => { onCopy(); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }} />)}{copied && <span className="copy-note">Response copied</span>}<LoadingMessage /></div>; }
