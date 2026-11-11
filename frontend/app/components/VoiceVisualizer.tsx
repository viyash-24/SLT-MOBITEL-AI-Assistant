"use client";

import { useEffect, useRef } from "react";
import type { VoiceSessionState } from "../hooks/useVoiceSession";

type VoiceVisualizerProps = {
  state: VoiceSessionState;
};

/**
 * Animated waveform bars that reflect the current voice session state.
 * Listening  → bouncing green bars
 * Speaking   → bouncing blue bars
 * Processing → pulsing amber bar
 * Idle/Error → flat bars
 */
export function VoiceVisualizer({ state }: VoiceVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /* ── Live mic analyser while listening ── */
  useEffect(() => {
    if (state !== "listening") {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      return;
    }
    let mounted = true;
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;
      })
      .catch(() => {
        /* Microphone denied — waveform falls back to animated bars */
      });
    return () => {
      mounted = false;
    };
  }, [state]);

  /* ── Canvas draw loop ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const BARS = 24;
    let frame = 0;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      frame++;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const barW = Math.floor(W / BARS) - 2;
      const cx = W / 2;
      const cy = H / 2;

      const freqData = analyserRef.current
        ? new Uint8Array(analyserRef.current.frequencyBinCount)
        : null;
      if (freqData && analyserRef.current) {
        analyserRef.current.getByteFrequencyData(freqData);
      }

      for (let i = 0; i < BARS; i++) {
        let heightFraction = 0.08; // flat idle

        if (state === "listening") {
          if (freqData) {
            const idx = Math.floor((i / BARS) * freqData.length);
            heightFraction = 0.05 + (freqData[idx] / 255) * 0.9;
          } else {
            // Animated fallback when mic not yet connected
            heightFraction =
              0.1 +
              0.6 *
                Math.abs(
                  Math.sin(frame * 0.07 + i * 0.4) *
                    Math.sin(frame * 0.03 + i * 0.1)
                );
          }
        } else if (state === "speaking") {
          heightFraction =
            0.15 +
            0.65 *
              Math.abs(
                Math.sin(frame * 0.09 + i * 0.5) *
                  Math.cos(frame * 0.05 + i * 0.2)
              );
        } else if (state === "processing") {
          const wave = Math.abs(Math.sin((frame * 0.05 + i * 0.3) % Math.PI));
          heightFraction = 0.08 + 0.25 * wave;
        }

        const barH = heightFraction * H;
        const x = cx - (BARS / 2) * (barW + 2) + i * (barW + 2);
        const y = cy - barH / 2;

        const gradient = ctx.createLinearGradient(x, y, x, y + barH);
        if (state === "listening") {
          gradient.addColorStop(0, "#00c97220");
          gradient.addColorStop(0.5, "#00c972");
          gradient.addColorStop(1, "#00c97220");
        } else if (state === "speaking") {
          gradient.addColorStop(0, "#0646a320");
          gradient.addColorStop(0.5, "#0646a3");
          gradient.addColorStop(1, "#0646a320");
        } else if (state === "processing") {
          gradient.addColorStop(0, "#f59e0b30");
          gradient.addColorStop(0.5, "#f59e0b");
          gradient.addColorStop(1, "#f59e0b30");
        } else {
          gradient.addColorStop(0, "#dfe8f310");
          gradient.addColorStop(0.5, "#dfe8f3");
          gradient.addColorStop(1, "#dfe8f310");
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [state]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={100}
      aria-hidden="true"
      style={{ display: "block", margin: "0 auto" }}
    />
  );
}
