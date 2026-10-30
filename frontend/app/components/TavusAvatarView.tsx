"use client";

/**
 * TavusAvatarView — renders the Tavus realistic human avatar.
 *
 * The Tavus agent joins the LiveKit room as a participant with identity
 * "tavus-avatar-agent" and publishes synchronized video + audio tracks.
 * This component subscribes to those tracks and renders them in a <video>
 * element. Audio from the Tavus participant is attached to a hidden
 * <audio> element so the browser plays it.
 *
 * States rendered:
 *   disabled   — TAVUS_API_KEY not configured, show a static portrait fallback.
 *   connecting — Tavus conversation is starting, show spinner.
 *   connected  — Avatar video track subscribed, render <video>.
 *   error      — Tavus failed to start, show error banner.
 */

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { AvatarState } from "../hooks/useLiveVoiceSession";

// The identity used by the Tavus agent — must match _AVATAR_AGENT_IDENTITY in
// livekit.plugins.tavus.avatar (currently "tavus-avatar-agent").
const TAVUS_IDENTITY = "tavus-avatar-agent";

export type TavusAvatarStatus =
  | "disabled"     // TAVUS_API_KEY not set
  | "connecting"   // Tavus conversation starting
  | "connected"    // Video track live
  | "error";       // Tavus failed

type TavusAvatarViewProps = {
  /** LiveKit room (null when voice session not yet started) */
  room: Room | null;
  /** Current agent conversation state for overlay/aura */
  state: AvatarState;
  /** Current audio energy level 0–1 for pulsing rings */
  audioLevel: number;
  /** Tavus avatar status from data-channel events */
  avatarStatus: TavusAvatarStatus;
  /** Error reason when avatarStatus === "error" */
  avatarError?: string;
};

export function TavusAvatarView({
  room,
  state,
  audioLevel,
  avatarStatus,
  avatarError,
}: TavusAvatarViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioTrackRef = useRef<Track | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  // Subscribe to the Tavus participant's video and audio tracks when the room
  // is connected and the Tavus agent has joined.
  useEffect(() => {
    if (!room) return;
    const audioElement = audioRef.current;

    const playAudio = () => {
      const audio = audioElement;
      if (!audio) return;
      void audio.play().catch(() => {
        // Playback may still be locked until the browser receives a user gesture.
        void room.startAudio().then(() => audio.play()).catch(() => undefined);
      });
    };

    const attachTavusTracks = () => {
      for (const [, participant] of room.remoteParticipants) {
        if (participant.identity !== TAVUS_IDENTITY) continue;
        for (const publication of participant.trackPublications.values()) {
          const track = publication.track;
          if (!track) continue;
          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
            setVideoReady(true);
          }
          if (track.kind === Track.Kind.Audio && audioElement) {
            if (audioTrackRef.current === track) continue;
            if (audioTrackRef.current) {
              audioTrackRef.current.detach(audioElement);
            }
            audioTrackRef.current = track;
            track.attach(audioElement);
            playAudio();
          }
        }
      }
    };

    const handleTrackSubscribed = (
      track: Track,
      _: unknown,
      participant: { identity: string }
    ) => {
      if (participant.identity !== TAVUS_IDENTITY) return;
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current);
        setVideoReady(true);
      }
      if (track.kind === Track.Kind.Audio && audioElement) {
        if (audioTrackRef.current === track) return;
        if (audioTrackRef.current) {
          audioTrackRef.current.detach(audioElement);
        }
        audioTrackRef.current = track;
        track.attach(audioElement);
        playAudio();
      }
    };

    const handleTrackUnsubscribed = (
      track: Track,
      _: unknown,
      participant: { identity: string }
    ) => {
      if (participant.identity !== TAVUS_IDENTITY) return;
      track.detach();
      if (track.kind === Track.Kind.Video) {
        setVideoReady(false);
      } else if (audioTrackRef.current === track) {
        audioTrackRef.current = null;
        audioElement?.pause();
        if (audioElement) audioElement.srcObject = null;
      }
    };

    // Attach any already-subscribed tracks (race: Tavus may have joined before
    // this effect ran).
    attachTavusTracks();

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      if (audioTrackRef.current && audioElement) {
        audioTrackRef.current.detach(audioElement);
      }
      audioTrackRef.current = null;
    };
  }, [room]);

  // ── Render ────────────────────────────────────────────────────────────────

  const isConnecting =
    avatarStatus === "connecting" ||
    (avatarStatus !== "disabled" && avatarStatus !== "error" && !videoReady);

  return (
    <div className="tavus-avatar-shell">
      {/* Hidden audio element for Tavus participant audio */}
      {/* Tavus routes agent TTS through its own synchronized audio track;
          the agent's own LiveKit track is replaced with DataStreamAudioOutput.
          We must NOT attach the agent's original audio here — the room hook
          in useLiveVoiceSession already attaches non-Tavus audio tracks. */}
      <audio
        ref={audioRef}
        autoPlay
        preload="auto"
        aria-hidden="true"
        data-tavus-audio="true"
        className="sr-only"
      />

      {/* Video element — hidden until Tavus track is live */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        className={`tavus-avatar-video ${videoReady ? "tavus-video-live" : "tavus-video-hidden"}`}
        aria-label="SLT-MOBITEL virtual customer-care representative"
      />

      {/* Connecting spinner overlay */}
      {isConnecting && (
        <div className="tavus-overlay-connecting">
          <div className="tavus-spinner" />
          <p>Connecting to avatar…</p>
        </div>
      )}

      {/* Disabled fallback — static portrait when no Tavus key */}
      {avatarStatus === "disabled" && (
        <div className="tavus-overlay-disabled">
          <Image
            src="/images/avatar.jpg"
            alt="SLT-MOBITEL virtual representative"
            width={240}
            height={240}
            className="tavus-fallback-portrait"
            priority
          />
          <p className="tavus-fallback-label">Voice Agent</p>
        </div>
      )}

      {/* Error overlay */}
      {avatarStatus === "error" && (
        <div className="tavus-overlay-error">
          <Image
            src="/images/avatar.jpg"
            alt="SLT-MOBITEL virtual representative"
            width={240}
            height={240}
            className="tavus-fallback-portrait"
            priority
          />
          <p className="tavus-error-label">Avatar temporarily unavailable</p>
          {avatarError && (
            <p className="tavus-error-detail">{avatarError}</p>
          )}
        </div>
      )}
    </div>
  );
}
