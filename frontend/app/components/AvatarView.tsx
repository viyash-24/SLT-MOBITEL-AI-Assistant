"use client";

import { memo } from "react";
import { TavusAvatarView } from "./TavusAvatarView";

export type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type AvatarViewProps = {
  state: VoiceState;
  audioLevel?: number;
  isMuted?: boolean;
  /** Live Tavus conversation URL — when set, the real video avatar is shown */
  conversationUrl?: string | null;
};

export const AvatarView = memo(function AvatarView({
  state,
  audioLevel = 0,
  isMuted = false,
  conversationUrl = null,
}: AvatarViewProps) {
  // When in Tavus live mode, suppress the aura rings because the full-width
  // video iframe fills its own container — the rings would be invisible.
  const isLiveTavus = Boolean(conversationUrl);

  return (
    <div className={`avatar-aura-ring aura-${state} ${isLiveTavus ? "aura-tavus-live" : ""}`}>
      {/* Dynamic visual energy rings — hidden in Tavus live mode */}
      {!isLiveTavus && (
        <>
          <div
            className="aura-pulse-1"
            style={{ transform: `scale(${1 + Math.min(audioLevel * 0.35, 0.4)})` }}
          />
          <div
            className="aura-pulse-2"
            style={{ transform: `scale(${1 + Math.min(audioLevel * 0.65, 0.7)})` }}
          />
        </>
      )}

      <div className={`avatar-image-container ${isLiveTavus ? "avatar-container-tavus" : ""}`}>
        <TavusAvatarView
          state={state}
          audioLevel={audioLevel}
          isMuted={isMuted}
          conversationUrl={conversationUrl}
        />
      </div>
    </div>
  );
});
