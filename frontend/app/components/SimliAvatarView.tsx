"use client";

/**
 * SimliAvatarView — renders the Simli real-time lip-sync avatar video.
 *
 * Receives refs to the <video> and <audio> elements that SimliClient
 * writes into. Displays a spinner while connecting and falls back to
 * null (caller renders AvatarFaceView) when Simli is not connected.
 *
 * Layout: fills the parent avatar-image-container (190 × 190 px circle).
 */

import { memo } from "react";
import type { RefObject } from "react";
import type { SimliAvatarStatus } from "../hooks/useSimliAvatar";

export type SimliAvatarViewProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
  status: SimliAvatarStatus;
};

export const SimliAvatarView = memo(function SimliAvatarView({
  videoRef,
  audioRef,
  status,
}: SimliAvatarViewProps) {
  const isConnecting = status === "fetching-token" || status === "connecting";
  const isConnected = status === "connected";

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        overflow: "hidden",
        background: "#07152c",
      }}
    >
      {/* Hidden audio element — Simli writes decoded audio here */}
      <audio
        ref={audioRef as RefObject<HTMLAudioElement>}
        autoPlay
        style={{ display: "none" }}
      />

      {/* Simli video — always rendered so the ref is available immediately */}
      <video
        ref={videoRef as RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        className="simli-avatar-video"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "50%",
          display: isConnected ? "block" : "none",
        }}
      />

      {/* Spinner overlay while Simli is negotiating WebRTC */}
      {isConnecting && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(7, 21, 44, 0.80)",
            backdropFilter: "blur(4px)",
            borderRadius: "50%",
            color: "#dffcff",
            fontSize: "12px",
            gap: "6px",
          }}
        >
          <div className="live-status-spinner" />
          <p style={{ margin: 0 }}>Loading avatar...</p>
        </div>
      )}
    </div>
  );
});
