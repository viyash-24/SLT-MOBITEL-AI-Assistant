"use client";

/**
 * TavusAvatarView — SLT-MOBITEL AI Realistic Face Avatar
 *
 * Renders in one of two modes, chosen automatically:
 *
 *  MODE A — LIVE TAVUS (when `conversationUrl` is provided)
 *    Embeds the Tavus Conversational Video Interface (CVI) in a sandboxed
 *    iframe backed by Daily.co WebRTC. The Tavus avatar sees and hears the
 *    user through the browser's camera/microphone, responds with its own
 *    voice, and delivers real-time, physics-accurate lip synchronisation
 *    handled entirely inside the Tavus platform.
 *
 *  MODE B — CANVAS FALLBACK (when `conversationUrl` is null / not configured)
 *    60 FPS canvas rendering loop that simulates lip-sync, eye blinking,
 *    and head micro-movements driven by the live `audioLevel` from the
 *    existing Gemini voice WebSocket pipeline.
 *
 * Both modes share the same outer shell and aura-ring styling so the UI
 * never jumps between layouts when switching modes.
 */

import Image from "next/image";
import { useEffect, useRef, useState, memo } from "react";
import type { VoiceState } from "./AvatarView";

export type TavusAvatarViewProps = {
  state: VoiceState;
  audioLevel?: number;
  isMuted?: boolean;
  /** When provided the Tavus iframe is shown; when null the canvas fallback is used */
  conversationUrl?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT A: Live Tavus CVI iframe
// ─────────────────────────────────────────────────────────────────────────────

const TavusIframe = memo(function TavusIframe({
  conversationUrl,
}: {
  conversationUrl: string;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="tavus-iframe-shell">
      {/* Loading shimmer shown until iframe reports load */}
      {!loaded && (
        <div className="tavus-iframe-loading">
          <div className="tavus-spinner" />
          <p>Connecting avatar…</p>
        </div>
      )}
      <iframe
        src={conversationUrl}
        allow="camera; microphone; fullscreen; display-capture; autoplay; encrypted-media"
        allowFullScreen
        onLoad={() => setLoaded(true)}
        className={`tavus-live-iframe ${loaded ? "tavus-iframe-visible" : "tavus-iframe-hidden"}`}
        title="Tavus AI Conversational Video Avatar — SLT-MOBITEL Virtual Representative"
        // Minimal sandbox: allow-scripts + allow-same-origin needed for Daily.co WebRTC;
        // allow-popups for any Tavus in-session overlays.
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
      />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENT B: 60 FPS Canvas Fallback with Lip-Sync
// ─────────────────────────────────────────────────────────────────────────────

const CanvasFallbackAvatar = memo(function CanvasFallbackAvatar({
  state,
  audioLevel,
}: {
  state: VoiceState;
  audioLevel: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const baseImageRef = useRef<HTMLImageElement | null>(null);

  // Mutable refs for the rAF loop — avoids stale closure captures
  const stateRef = useRef<VoiceState>(state);
  const audioLevelRef = useRef<number>(audioLevel);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { audioLevelRef.current = audioLevel; }, [audioLevel]);

  // Load avatar base photo
  useEffect(() => {
    const img = new window.Image();
    img.src = "/images/avatar.jpg";
    img.onload = () => {
      baseImageRef.current = img;
      setImageLoaded(true);
    };
  }, []);

  // 60 FPS rendering loop
  useEffect(() => {
    if (!imageLoaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) return;

    let animId: number;
    let smoothLevel = 0;
    let nextBlinkTime = performance.now() + 3500 + Math.random() * 1500;
    let blinkStartTime = 0;
    let isBlinking = false;

    const W = 1024;
    const H = 1024;
    canvas.width = W;
    canvas.height = H;

    // Facial landmark anchors (1024×1024 coordinate space)
    const mouthCx = 505;
    const mouthCy = 528;
    const mouthW = 60;
    const leftEyeX = 415;
    const rightEyeX = 585;
    const eyesY = 390;

    const render = (timestamp: number) => {
      const baseImg = baseImageRef.current;
      if (!baseImg) { animId = requestAnimationFrame(render); return; }

      const currentState = stateRef.current;
      const targetLevel =
        currentState === "speaking" ? Math.min(1.0, audioLevelRef.current * 1.85) : 0;

      const attack = 0.42;
      const decay = 0.22;
      smoothLevel += (targetLevel - smoothLevel) * (targetLevel > smoothLevel ? attack : decay);
      if (smoothLevel < 0.005) smoothLevel = 0;

      // Blink animation (every ~4–6 s, lasts ~160 ms)
      if (!isBlinking && timestamp >= nextBlinkTime) {
        isBlinking = true;
        blinkStartTime = timestamp;
      }
      let blinkProgress = 0;
      if (isBlinking) {
        const elapsed = timestamp - blinkStartTime;
        if (elapsed < 80) blinkProgress = elapsed / 80;
        else if (elapsed < 160) blinkProgress = 1.0 - (elapsed - 80) / 80;
        else { isBlinking = false; nextBlinkTime = timestamp + 3500 + Math.random() * 2000; }
      }

      // Conversational head micro-movements
      const tSec = timestamp * 0.001;
      let headTilt = 0;
      let headY = 0;
      let headX = 0;

      if (currentState === "speaking") {
        headTilt = Math.sin(tSec * 4.2) * (0.4 + smoothLevel * 0.8);
        headY = Math.cos(tSec * 5.0) * (1.2 + smoothLevel * 3.5);
        headX = Math.sin(tSec * 2.8) * 1.2;
      } else if (currentState === "listening") {
        headTilt = 0.9 + Math.sin(tSec * 1.4) * 0.3;
        headY = Math.sin(tSec * 1.8) * 1.2;
      } else if (currentState === "thinking") {
        headTilt = -1.1 + Math.sin(tSec * 1.2) * 0.25;
        headY = -1.8 + Math.cos(tSec * 1.5) * 0.8;
      } else {
        headY = Math.sin(tSec * 1.4) * 1.5;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W * 0.5 + headX, H * 0.5 + headY);
      ctx.rotate((headTilt * Math.PI) / 180);
      ctx.translate(-W * 0.5, -H * 0.5);

      // 1. Base photo
      ctx.drawImage(baseImg, 0, 0, W, H);

      // 2. Real-time lip articulation
      if (smoothLevel > 0.02) {
        const jawDrop = smoothLevel * 18.0;
        const upperLift = smoothLevel * 3.2;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(445, 527);
        ctx.quadraticCurveTo(mouthCx, 527 - upperLift, 565, 527);
        ctx.quadraticCurveTo(mouthCx, 528 + jawDrop, 445, 527);
        ctx.closePath();

        const cavityGrad = ctx.createRadialGradient(
          mouthCx, mouthCy + jawDrop * 0.35, 2,
          mouthCx, mouthCy + jawDrop * 0.35, mouthW * 0.95
        );
        cavityGrad.addColorStop(0, "#22080a");
        cavityGrad.addColorStop(0.75, "#140405");
        cavityGrad.addColorStop(1, "#0a0203");
        ctx.fillStyle = cavityGrad;
        ctx.fill();
        ctx.clip();

        // Upper teeth
        const teethExposure = Math.min(1.0, smoothLevel * 1.5);
        if (teethExposure > 0.05) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(462, 525);
          ctx.quadraticCurveTo(mouthCx, 526 + teethExposure * 6.5, 548, 525);
          ctx.quadraticCurveTo(mouthCx, 524, 462, 525);
          ctx.closePath();
          const teethGrad = ctx.createLinearGradient(0, 524, 0, 532);
          teethGrad.addColorStop(0, "#fffcf9");
          teethGrad.addColorStop(0.7, "#f7f2ed");
          teethGrad.addColorStop(1, "#d9d0c7");
          ctx.fillStyle = teethGrad;
          ctx.fill();
          ctx.strokeStyle = "rgba(180,165,155,0.35)";
          ctx.lineWidth = 1;
          for (let tx = 485; tx <= 525; tx += 10) {
            ctx.beginPath(); ctx.moveTo(tx, 525); ctx.lineTo(tx, 529); ctx.stroke();
          }
          ctx.restore();
        }

        // Lower tongue
        if (jawDrop > 7) {
          ctx.save();
          ctx.beginPath();
          const tongueY = 528 + jawDrop * 0.85;
          ctx.moveTo(475, tongueY);
          ctx.quadraticCurveTo(mouthCx, 528 + jawDrop * 0.55, 535, tongueY);
          ctx.quadraticCurveTo(mouthCx, tongueY + 6, 475, tongueY);
          ctx.closePath();
          const tongueGrad = ctx.createRadialGradient(mouthCx, tongueY, 2, mouthCx, tongueY, 26);
          tongueGrad.addColorStop(0, "#d86b6e");
          tongueGrad.addColorStop(1, "#ad4144");
          ctx.fillStyle = tongueGrad;
          ctx.fill();
          ctx.restore();
        }

        ctx.restore(); // oral cavity clip

        // Displace lower lip / chin
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(445, 527);
        ctx.quadraticCurveTo(mouthCx, 528 + jawDrop, 565, 527);
        ctx.lineTo(580, 615);
        ctx.quadraticCurveTo(mouthCx, 625, 430, 615);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(baseImg, 430, 528, 150, 92, 430, 528 + jawDrop * 0.88, 150, 92);
        ctx.restore();
      }

      // 3. Eye blinking overlay
      if (blinkProgress > 0.05) {
        ctx.save();
        ctx.fillStyle = "#f3bfad";
        const lh = blinkProgress * 30;
        ctx.beginPath();
        ctx.ellipse(leftEyeX, eyesY - 14 + lh * 0.5, 34, lh * 0.5 + 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#1b1928"; ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(leftEyeX, eyesY - 14 + lh, 32, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(rightEyeX, eyesY - 14 + lh * 0.5, 34, lh * 0.5 + 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rightEyeX, eyesY - 14 + lh, 32, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore(); // head transform
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [imageLoaded]);

  return (
    <div className="tavus-avatar-shell">
      <Image
        src="/images/avatar.jpg"
        alt="SLT-MOBITEL Virtual Representative Kasuni"
        fill
        sizes="190px"
        priority
        className={`tavus-avatar-video ${imageLoaded ? "tavus-video-hidden" : "tavus-video-live"}`}
        style={{ objectFit: "cover", borderRadius: "50%" }}
      />
      <canvas
        ref={canvasRef}
        className={`tavus-avatar-video ${imageLoaded ? "tavus-video-live" : "tavus-video-hidden"}`}
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
        aria-label="SLT-MOBITEL AI Avatar with real-time lip sync"
      />
      {state === "connecting" && (
        <div className="tavus-overlay-connecting">
          <div className="tavus-spinner" />
          <p>Connecting…</p>
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — selects the correct mode automatically
// ─────────────────────────────────────────────────────────────────────────────

export const TavusAvatarView = memo(function TavusAvatarView({
  state,
  audioLevel = 0,
  isMuted = false,
  conversationUrl = null,
}: TavusAvatarViewProps) {
  // If a live Tavus conversation URL exists, render the real video avatar.
  // Otherwise, fall back to the 60 FPS canvas animation.
  if (conversationUrl) {
    return <TavusIframe conversationUrl={conversationUrl} />;
  }

  return (
    <CanvasFallbackAvatar
      state={state}
      audioLevel={audioLevel}
    />
  );
});
