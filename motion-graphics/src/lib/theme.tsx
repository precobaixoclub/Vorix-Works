import React, { useEffect, useState } from "react";
import { continueRender, delayRender, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/** Região normalizada (0–1) da mídia original: estampa do produto ou componente da tela. */
export type Region = { x: number; y: number; w: number; h: number };

export type Brand = {
  name: string;
  primary: string;
  accent: string;
  light: string;
  dark: string;
  display: "Barlow Condensed" | "DM Serif Display";
  logo?: string;
};

/** Base HTTP local (o renderizador serve os arquivos do job e as fontes). */
export type Common = { assetBase: string; brand: Brand };

const FONT_FILES: Record<string, string> = { "Barlow Condensed": "barlow-condensed-bold.ttf", "DM Serif Display": "dm-serif-display-regular.ttf" };

/** Fontes da marca (TTF do repositório) carregadas antes do primeiro quadro. */
export function useFonts(assetBase: string) {
  const [handle] = useState(() => delayRender("fontes"));
  useEffect(() => {
    Promise.all(Object.entries(FONT_FILES).map(async ([family, file]) => {
      const face = new FontFace(family, `url(${assetBase}/fonts/${file})`);
      await face.load();
      (document.fonts as unknown as { add(item: FontFace): void }).add(face);
    })).then(() => continueRender(handle), () => continueRender(handle));
  }, [assetBase, handle]);
}

export const ease = Easing.bezier(0.22, 1, 0.36, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** Progresso suavizado entre dois quadros. */
export function progress(frame: number, from: number, to: number, easing = ease) {
  return interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}

export function useSpring(delay = 0, config: { damping?: number; mass?: number; stiffness?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 18, mass: 0.9, stiffness: 110, ...config } });
}

export function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export const onColor = (background: string, brand: Brand) => (luminance(background) > 0.179 ? brand.dark : "#FFFFFF");

/**
 * Título cinético: cada palavra sobe de trás de uma máscara, em sequência (não é fade em bloco).
 * `exitAt` (quadro) faz a saída para cima no fim da cena.
 */
export const KineticText: React.FC<{ text: string; delay: number; size: number; color: string; font: string; weight?: number; stagger?: number; align?: "left" | "center"; exitAt?: number; lineHeight?: number; maxWidth?: number }> = ({ text, delay, size, color, font, weight = 700, stagger = 3, align = "center", exitAt, lineHeight = 1.02, maxWidth }) => {
  const frame = useCurrentFrame();
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", gap: `0 ${size * 0.24}px`, fontFamily: font, fontSize: size, fontWeight: weight, color, lineHeight, letterSpacing: font === "Barlow Condensed" ? "0.01em" : "-0.01em", maxWidth, textTransform: font === "Barlow Condensed" ? "uppercase" : "none" }}>
      {words.map((word, index) => {
        const p = progress(frame, delay + index * stagger, delay + index * stagger + 14);
        const out = exitAt === undefined ? 0 : progress(frame, exitAt + index * 1.5, exitAt + index * 1.5 + 10, easeInOut);
        return (
          <span key={index} style={{ display: "inline-block", overflow: "hidden", paddingBottom: size * 0.08 }}>
            <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 110 - out * 110}%) rotate(${(1 - p) * 4}deg)`, opacity: p }}>{word}</span>
          </span>
        );
      })}
    </div>
  );
};

/** Faixa de cor que cresce (acento gráfico que conduz a leitura). */
export const AccentBar: React.FC<{ delay: number; width: number; height: number; color: string; vertical?: boolean }> = ({ delay, width, height, color, vertical }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, delay, delay + 16);
  return <div style={{ width: vertical ? width : width * p, height: vertical ? height * p : height, background: color, borderRadius: Math.min(width, height) / 2 }} />;
};

/** Reflexo de luz que atravessa uma superfície uma vez (acabamento "premium" sem alterar a foto). */
export const LightSweep: React.FC<{ start: number; duration: number; angle?: number; intensity?: number }> = ({ start, duration, angle = 20, intensity = 0.22 }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, start, start + duration, easeInOut);
  if (p <= 0 || p >= 1) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: "screen", background: `linear-gradient(${90 + angle}deg, transparent ${p * 140 - 40}%, rgba(255,255,255,${intensity}) ${p * 140 - 20}%, transparent ${p * 140}%)` }} />
  );
};

/** Granulação/vinheta suave: tira a cara de "slide" de fundos chapados. */
export const Atmosphere: React.FC<{ color: string; glow: string }> = ({ color, glow }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / Math.max(1, durationInFrames);
  return (
    <div style={{ position: "absolute", inset: 0, background: color, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: width * 1.4, height: width * 1.4, left: width * (-0.2 + 0.25 * t), top: height * (0.05 + 0.1 * t), borderRadius: "50%", background: `radial-gradient(circle, ${glow}55 0%, ${glow}00 62%)` }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)" }} />
    </div>
  );
};
