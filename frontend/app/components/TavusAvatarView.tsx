"use client";

import { useEffect, useRef, useState } from "react";

/** One media element plays the avatar's synchronized WebRTC video and audio. */
export function TavusAvatarView({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsPlayback, setNeedsPlayback] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    video.srcObject = stream;
    void video.play().then(() => {
      if (!disposed) setNeedsPlayback(false);
    }).catch(() => {
      if (!disposed) setNeedsPlayback(true);
    });
    return () => {
      disposed = true;
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  const resumePlayback = async () => {
    try {
      await videoRef.current?.play();
      setNeedsPlayback(false);
    } catch {
      setNeedsPlayback(true);
    }
  };

  return (
    <div className="tavus-avatar-player">
      <video ref={videoRef} autoPlay playsInline aria-label="SLT Avatar live video" className="tavus-avatar-media" />
      {needsPlayback && (
        <button className="control-btn avatar-playback-btn" onClick={resumePlayback}>
          Enable avatar audio and video
        </button>
      )}
    </div>
  );
}
