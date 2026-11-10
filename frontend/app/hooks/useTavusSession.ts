"use client";

/**
 * useTavusSession — SLT-MOBITEL AI Assistant
 *
 * Manages the full lifecycle of a Tavus Conversational Video Interface (CVI)
 * session. Tavus CVI is the SOLE AI assistant on the voice page — it handles
 * microphone input, AI reasoning (via the configured persona), speech synthesis,
 * and real-time lip-sync entirely within the Daily.co WebRTC iframe.
 *
 * Lifecycle:
 *   1. Checks whether Tavus is configured on the server (GET /api/tavus/status)
 *   2. Creates a new conversation session (POST /api/tavus/conversation) which
 *      returns a Daily.co-backed `conversation_url` for the WebRTC video iframe.
 *   3. Ends the session cleanly (POST /api/tavus/conversation/end) on unmount
 *      or when the user hangs up, so Tavus minutes are not wasted.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type TavusSessionState =
  | "idle"         // Not started yet
  | "checking"     // Checking if Tavus is configured
  | "not_configured" // Server has no TAVUS_API_KEY — use canvas fallback
  | "connecting"   // Waiting for create-conversation API response
  | "active"       // conversation_url obtained; iframe is live
  | "ending"       // Waiting for end-conversation call to complete
  | "error";       // Something went wrong

export type UseTavusSessionResult = {
  tavusState: TavusSessionState;
  conversationUrl: string | null;
  conversationId: string | null;
  tavusError: string | null;
  isConfigured: boolean;
  startTavusSession: (options?: TavusStartOptions) => Promise<void>;
  endTavusSession: () => Promise<void>;
};

export type TavusStartOptions = {
  conversationalContext?: string;
  customGreeting?: string;
  conversationName?: string;
};

function getApiBase(): string {
  const envApi = process.env.NEXT_PUBLIC_API_URL;
  if (envApi) return envApi.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const host = `${window.location.hostname || "127.0.0.1"}:8000`;
    return `${window.location.protocol}//${host}`;
  }
  return "http://127.0.0.1:8000";
}

export function useTavusSession(): UseTavusSessionResult {
  const [tavusState, setTavusState] = useState<TavusSessionState>("idle");
  const [conversationUrl, setConversationUrl] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [tavusError, setTavusError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  // Track in-flight operations to prevent race conditions
  const activeConversationIdRef = useRef<string | null>(null);
  const isEndingRef = useRef(false);

  /**
   * Check the server for Tavus configuration on first use.
   * Sets isConfigured so the UI can decide whether to show the iframe
   * or fall back to the canvas avatar.
   */
  const checkConfiguration = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${getApiBase()}/api/tavus/status`);
      if (!res.ok) return false;
      const data = await res.json();
      const configured = Boolean(data.configured);
      setIsConfigured(configured);
      return configured;
    } catch {
      return false;
    }
  }, []);

  /**
   * Create a new Tavus CVI conversation.
   * On success, `conversationUrl` is set and the iframe can be displayed.
   */
  const startTavusSession = useCallback(
    async (options: TavusStartOptions = {}): Promise<void> => {
      // Prevent double-starts
      if (tavusState === "connecting" || tavusState === "active") return;

      setTavusError(null);
      setTavusState("checking");

      const configured = await checkConfiguration();
      if (!configured) {
        setTavusState("not_configured");
        return;
      }

      setTavusState("connecting");

      try {
        const res = await fetch(`${getApiBase()}/api/tavus/conversation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversational_context:
              options.conversationalContext ??
              "You are Kasuni, a friendly and professional SLT-MOBITEL AI customer care representative. " +
              "Help customers with their telecom queries about broadband, mobile, fiber, and SLT-MOBITEL services. " +
              "Be warm, concise, and always polite.",
            custom_greeting:
              options.customGreeting ??
              "Hello! I'm Kasuni, your SLT-MOBITEL AI assistant. How can I help you today?",
            conversation_name: options.conversationName ?? "SLT-MOBITEL AI Voice Session",
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const detail: string = errData.detail ?? `Server error ${res.status}`;
          // 402 → account out of credits; degrade to canvas fallback rather
          // than showing a hard error state.
          if (res.status === 402) {
            console.warn("[Tavus] Out of conversational credits — falling back to canvas avatar.", detail);
            setTavusState("not_configured");
            return;
          }
          throw new Error(detail);
        }

        const data = await res.json();
        const url: string = data.conversation_url;
        const id: string = data.conversation_id;

        if (!url) throw new Error("Server did not return a conversation URL.");

        activeConversationIdRef.current = id;
        setConversationId(id);
        setConversationUrl(url);
        setTavusState("active");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to start Tavus session.";
        console.error("[Tavus] startTavusSession error:", msg);
        setTavusError(msg);
        setTavusState("error");
      }
    },
    [tavusState, checkConfiguration]
  );

  /**
   * Cleanly end the active Tavus conversation.
   * Safe to call multiple times — no-ops when already idle.
   */
  const endTavusSession = useCallback(async (): Promise<void> => {
    const id = activeConversationIdRef.current;
    if (!id || isEndingRef.current) return;

    isEndingRef.current = true;
    setTavusState("ending");

    try {
      await fetch(`${getApiBase()}/api/tavus/conversation/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: id }),
      });
    } catch (err) {
      // Non-fatal — the session will expire on Tavus's side anyway
      console.warn("[Tavus] endTavusSession warning:", err);
    } finally {
      activeConversationIdRef.current = null;
      isEndingRef.current = false;
      setConversationId(null);
      setConversationUrl(null);
      setTavusState("idle");
    }
  }, []);

  // Auto-cleanup on component unmount
  useEffect(() => {
    return () => {
      const id = activeConversationIdRef.current;
      if (!id || isEndingRef.current) return;
      // Fire-and-forget: do not await in cleanup
      isEndingRef.current = true;
      fetch(`${getApiBase()}/api/tavus/conversation/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: id }),
      }).catch(() => {});
      activeConversationIdRef.current = null;
    };
  }, []);

  return {
    tavusState,
    conversationUrl,
    conversationId,
    tavusError,
    isConfigured,
    startTavusSession,
    endTavusSession,
  };
}
