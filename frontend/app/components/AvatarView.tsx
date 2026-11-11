"use client";

import { memo } from "react";
import type { RefObject } from "react";
import { AvatarFaceView } from "./AvatarFaceView";
import { SimliAvatarView } from "./SimliAvatarView";
import type { SimliAvatarStatus } from "../hooks/useSimliAvatar";

export type VoiceState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type AvatarViewProps = {
  state: VoiceState;
  audioLevel?: number;
  isMuted?: boolean;
  /** Pass when Simli integration is active */
  simliStatus?: SimliAvatarStatus;
  simliVideoRef?: RefObject<HTMLVideoElement | null>;
  simliAudioRef?: RefObject<HTMLAudioElement | null>;
};

export const AvatarView = memo(function AvatarView({
  state,
  audioLevel = 0,
  isMuted = false,
  simliStatus,
  simliVideoRef,
  simliAudioRef,
}: AvatarViewProps) {
  // Show Simli when it is fetching, connecting, or fully connected.
  // Fall back to canvas face when idle / stopped / errored.
  const showSimli =
    simliVideoRef != null &&
    simliAudioRef != null &&
    simliStatus != null &&
    (simliStatus === "fetching-token" ||
      simliStatus === "connecting" ||
      simliStatus === "connected");

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
        {showSimli ? (
          <SimliAvatarView
            videoRef={simliVideoRef!}
            audioRef={simliAudioRef!}
            status={simliStatus!}
          />
        ) : (
          <AvatarFaceView state={state} audioLevel={audioLevel} isMuted={isMuted} />
        )}
      </div>
    </div>
  );
});
