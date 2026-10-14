"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { AvatarState } from "../hooks/useLiveVoiceSession";

type Live3DAvatarProps = {
  state: AvatarState;
  audioLevel: number;
};

export function Live3DAvatar({ state, audioLevel }: Live3DAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const audioLevelRef = useRef(audioLevel);
  const stateRef = useRef(state);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return;

    // ── Renderer ─────────────────────────────────────────────────────────────
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      // WebGL not available – keep the CSS fallback visible
      return;
    }

    // Hide CSS fallback once WebGL is confirmed working
    const fallback = shell.querySelector<HTMLElement>(".live-3d-avatar-fallback");
    if (fallback) fallback.style.display = "none";

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ── Scene & Camera ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 0.15, 5.2);

    // ── Lighting ──────────────────────────────────────────────────────────────
    const ambient = new THREE.HemisphereLight(0xffffff, 0x16345a, 2.2);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0x8fdcff, 3.5);
    keyLight.position.set(-2, 3, 4);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x37d6c5, 3.5, 8);
    rimLight.position.set(2, 1, 2);
    scene.add(rimLight);
    // Subtle fill from below to soften chin shadows
    const fillLight = new THREE.PointLight(0x4a90d9, 1.2, 6);
    fillLight.position.set(0, -2, 3);
    scene.add(fillLight);

    // ── Materials ─────────────────────────────────────────────────────────────
    const skin = new THREE.MeshStandardMaterial({ color: 0x9b644b, roughness: 0.72, metalness: 0.0 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x171c2a, roughness: 0.55 });
    const jacket = new THREE.MeshStandardMaterial({ color: 0x123b67, roughness: 0.58, metalness: 0.05 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xf1f7ff, roughness: 0.65 });
    const cyanMat = new THREE.MeshBasicMaterial({ color: 0x64e8ef });
    const mouthInnerMat = new THREE.MeshStandardMaterial({ color: 0x2a0c14, roughness: 0.9 });
    const lipMat = new THREE.MeshStandardMaterial({ color: 0x8b3a4a, roughness: 0.7 });
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8f4f0, roughness: 0.5 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111a2b });
    const irisMat = new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.3, metalness: 0.1 });
    const browMat = new THREE.MeshStandardMaterial({ color: 0x231207, roughness: 0.8 });

    // ── Avatar group ──────────────────────────────────────────────────────────
    const avatar = new THREE.Group();
    scene.add(avatar);

    // Shoulders / body
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(1.28, 32, 20), jacket);
    shoulders.scale.set(1.18, 0.56, 0.55);
    shoulders.position.y = -1.25;
    avatar.add(shoulders);

    // Shirt collar
    const collar = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.65, 4), shirt);
    collar.rotation.y = Math.PI / 4;
    collar.position.set(0, -0.9, 0.46);
    avatar.add(collar);

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.55, 24), skin);
    neck.position.y = -0.7;
    avatar.add(neck);

    // ── Head group ────────────────────────────────────────────────────────────
    const head = new THREE.Group();
    head.position.y = 0.25;
    avatar.add(head);

    const face = new THREE.Mesh(new THREE.SphereGeometry(0.84, 40, 28), skin);
    face.scale.set(0.84, 1.05, 0.82);
    head.add(face);

    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.87, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
      hair
    );
    hairCap.position.y = 0.25;
    hairCap.scale.set(0.98, 0.9, 0.92);
    head.add(hairCap);

    // Ears
    for (const ex of [-0.84, 0.84]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), skin);
      ear.position.set(ex * 0.72, 0.18, 0);
      ear.scale.set(0.52, 0.72, 0.42);
      head.add(ear);
    }

    // ── Eyes (white + iris + pupil) ───────────────────────────────────────────
    const eyeObjects: { white: THREE.Mesh; iris: THREE.Mesh; pupil: THREE.Mesh }[] = [];
    for (const ex of [-0.29, 0.29]) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.082, 16, 12), eyeWhiteMat);
      white.position.set(ex, 0.28, 0.77);
      head.add(white);

      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), irisMat);
      iris.position.set(ex, 0.28, 0.848);
      head.add(iris);

      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), pupilMat);
      pupil.position.set(ex, 0.28, 0.862);
      head.add(pupil);

      eyeObjects.push({ white, iris, pupil });
    }

    // ── Eyebrows ──────────────────────────────────────────────────────────────
    const brows: THREE.Mesh[] = [];
    for (const bx of [-0.29, 0.29]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.032, 0.04), browMat);
      brow.position.set(bx, 0.39, 0.77);
      brow.rotation.z = bx < 0 ? 0.08 : -0.08;
      head.add(brow);
      brows.push(brow);
    }

    // ── Mouth (upper lip + lower lip + inner cavity) ──────────────────────────
    const mouthGroup = new THREE.Group();
    mouthGroup.position.set(0, -0.22, 0.76);
    head.add(mouthGroup);

    const upperLip = new THREE.Mesh(new THREE.SphereGeometry(0.165, 24, 12), lipMat);
    upperLip.scale.set(1.35, 0.2, 0.25);
    upperLip.position.y = 0.03;
    mouthGroup.add(upperLip);

    const lowerLip = new THREE.Mesh(new THREE.SphereGeometry(0.165, 24, 12), lipMat);
    lowerLip.scale.set(1.35, 0.22, 0.28);
    lowerLip.position.y = -0.03;
    mouthGroup.add(lowerLip);

    const innerMouth = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 12), mouthInnerMat);
    innerMouth.scale.set(1.2, 0.08, 0.2);
    innerMouth.position.z = -0.02;
    mouthGroup.add(innerMouth);

    // ── Company badge (holographic spinning ring) ─────────────────────────────
    const badge = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 32), cyanMat);
    badge.position.set(0.56, -0.9, 0.55);
    badge.rotation.y = -0.35;
    avatar.add(badge);

    // ── Resize ────────────────────────────────────────────────────────────────
    const resize = () => {
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 320;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvas);
    resize();

    // ── Animation ─────────────────────────────────────────────────────────────
    let raf = 0;
    const startTime = performance.now();

    // Smooth mouth amplitude tracker
    let smoothMouth = 0;

    // Blink state
    let blinkTimer = 0;
    const BLINK_DUR = 0.11; // seconds
    let nextBlink = 4.2 + Math.random() * 2;

    const animate = () => {
      const elapsed = (performance.now() - startTime) * 0.001;

      const level = audioLevelRef.current;
      const s = stateRef.current;
      const speaking = s === "speaking";
      const thinking = s === "thinking";
      const listening = s === "listening";
      const connecting = s === "connecting";

      // ── Mouth lip-sync ────────────────────────────────────────────────────
      // Reacts when agent is speaking, or as soon as audio energy arrives (> 0.04)
      const isSpeakingAudio = speaking || (s !== "idle" && level > 0.04);
      const rawTarget = isSpeakingAudio ? Math.pow(Math.min(level * 2.2, 1), 0.65) : 0;
      const lerpRate = rawTarget > smoothMouth ? 0.44 : 0.18; // fast attack, natural release
      smoothMouth = THREE.MathUtils.lerp(smoothMouth, rawTarget, lerpRate);

      const jawDrop = smoothMouth * 0.18;
      lowerLip.position.y = -0.03 - jawDrop;
      upperLip.position.y = 0.03 + jawDrop * 0.3;
      lowerLip.scale.set(1.35 + smoothMouth * 0.12, 0.22 - smoothMouth * 0.06, 0.28);
      upperLip.scale.set(1.35 + smoothMouth * 0.08, 0.2 - smoothMouth * 0.04, 0.25);
      innerMouth.scale.y = 0.08 + smoothMouth * 0.55;
      innerMouth.scale.x = 1.2 + smoothMouth * 0.2;
      head.position.y = THREE.MathUtils.lerp(head.position.y, 0 - jawDrop * 0.12, 0.15);

      // ── Blink ─────────────────────────────────────────────────────────────
      blinkTimer += 0.016;
      if (blinkTimer >= nextBlink) {
        blinkTimer = 0;
        nextBlink = 4.2 + Math.random() * 2.5;
      }
      const blinkPhase = blinkTimer < BLINK_DUR ? Math.sin((blinkTimer / BLINK_DUR) * Math.PI) : 0;
      const eyeY = 1 - blinkPhase * 0.88;
      eyeObjects.forEach(({ white, iris, pupil }) => {
        white.scale.y = THREE.MathUtils.lerp(white.scale.y, eyeY, 0.5);
        iris.scale.y = white.scale.y;
        pupil.scale.y = white.scale.y;
      });

      // ── Eyebrow expression ────────────────────────────────────────────────
      const browRaise = thinking ? 0.04 : listening ? 0.015 : 0;
      brows.forEach((brow, i) => {
        brow.position.y = THREE.MathUtils.lerp(brow.position.y, 0.39 + browRaise, 0.06);
        const baseZ = i === 0 ? 0.08 : -0.08;
        const extraZ = thinking ? (i === 0 ? 0.04 : -0.04) : 0;
        brow.rotation.z = THREE.MathUtils.lerp(brow.rotation.z, baseZ + extraZ, 0.06);
      });

      // ── Body breathing float ──────────────────────────────────────────────
      const breathFreq = speaking ? 2.2 : 1.4;
      const breathAmp = speaking ? 0.032 + level * 0.04 : 0.014;
      avatar.position.y = Math.sin(elapsed * breathFreq) * breathAmp;

      // ── Head sway ─────────────────────────────────────────────────────────
      const swaySpeed = connecting ? 1.8 : 0.5;
      const swayAmp = listening ? 0.038 : connecting ? 0.025 : 0.016;
      avatar.rotation.y = Math.sin(elapsed * swaySpeed) * swayAmp;

      // ── Head tilt (thinking) ──────────────────────────────────────────────
      const tiltTarget = thinking ? 0.06 : 0;
      head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, tiltTarget, 0.04);
      head.rotation.z += Math.sin(elapsed * 0.9) * (thinking ? 0.018 : 0.008);

      // ── Badge spin ────────────────────────────────────────────────────────
      badge.rotation.z = elapsed * (speaking ? 1.4 : 0.6);

      // ── Key light drift (makes face feel alive) ────────────────────────────
      keyLight.position.x = -2 + Math.sin(elapsed * 0.4) * 0.5;
      keyLight.position.y = 3 + Math.cos(elapsed * 0.3) * 0.3;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      resizeObs.disconnect();
      renderer.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material?.dispose();
        }
      });
    };
  }, []);

  return (
    <div ref={shellRef} className="live-3d-avatar-shell">
      {/* CSS fallback shown until WebGL confirms it can render */}
      <div className="live-3d-avatar-fallback" aria-hidden="true">
        <span>SLT</span>
        <small>Virtual customer-care representative</small>
      </div>
      <canvas
        ref={canvasRef}
        className="live-3d-avatar"
        aria-label="Animated SLT-MOBITEL virtual customer-care representative"
        role="img"
      />
    </div>
  );
}
