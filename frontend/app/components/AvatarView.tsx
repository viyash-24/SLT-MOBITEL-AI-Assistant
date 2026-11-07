"use client";

import { memo } from "react";
import { TavusAvatarView } from "./TavusAvatarView";

export type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type AvatarViewProps = {
  state: VoiceState;
  audioLevel?: number;
  isMuted?: boolean;
};

export const AvatarView = memo(function AvatarView({
  state,
  audioLevel = 0,
  isMuted = false,
}: AvatarViewProps) {
  return (
    <div className={`avatar-aura-ring aura-${state}`}>
      {/* Dynamic visual energy rings pulsing with voice audio level */}
      <div
        className="aura-pulse-1"
        style={{
          transform: `scale(${1 + Math.min(audioLevel * 0.35, 0.4)})`,
        }}
      />
      <div
        className="aura-pulse-2"
        style={{
          transform: `scale(${1 + Math.min(audioLevel * 0.65, 0.7)})`,
        }}
      />

      <div className="avatar-image-container">
        <TavusAvatarView state={state} audioLevel={audioLevel} isMuted={isMuted} />
      </div>
    </div>
  );
});
