import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AccentBar, Atmosphere, KineticText, LightSweep, onColor, progress, type Common } from "../lib/theme";
import { resolveMotion, safeBox } from "../lib/motion";

/**
 * MOTION GRAPHICS CONCEITUAL — recursos para campanhas que não têm (ou não precisam de) filmagem: o diretor
 * criativo escolhe pelo conceito (tempo, número, comparação, metáfora revelada). Cada um tem função narrativa
 * marcada na linha do tempo (`timeline`), que é a MESMA usada pelo som (efeitos nos mesmos instantes).
 */

const display = (brand: Common["brand"]) => ({ font: brand.display, weight: brand.display === "DM Serif Display" ? 400 : 700 });

// ---------------------------------------------------------------------------------------------- relógio

/** Relógio/cronômetro: ponteiros que ACELERAM (o tempo escapando) e param de uma vez — a virada da história. */
export type ClockProps = Common & { lines: string[]; label?: string };

export const Clock: React.FC<ClockProps> = ({ brand, lines, label, motion: motionProps, safe, timeline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D, fps } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const tl = { lines: 0.06, accelStart: 0.12, stop: 0.74, ...timeline };
  const stopAt = tl.stop * D;
  // Ângulo do ponteiro dos minutos: velocidade cresce quadraticamente até a parada (integral da aceleração).
  const run = Math.min(frame, stopAt) - tl.accelStart * D;
  const t = Math.max(0, run) / Math.max(1, stopAt - tl.accelStart * D);
  const turns = 0.15 + 7.5 * t * t * m.intensity;
  const minuteDeg = turns * 360;
  const hourDeg = turns * 30 + 300;
  // Parada: um tranco (overshoot amortecido) e o mostrador "congela".
  const jolt = frame >= stopAt ? spring({ frame: frame - stopAt, fps, config: { damping: 9, stiffness: 220, mass: 0.6 } }) : 0;
  const shake = frame >= stopAt ? (1 - jolt) * 6 * Math.sin((frame - stopAt) * 2.2) : t > 0.6 ? Math.sin(frame * 3.1) * (t - 0.6) * 6 : 0;
  const enter = spring({ frame, fps, config: m.spring });
  const R = Math.min(box.width * 0.42, box.height * 0.24);
  const cx = width / 2;
  const cy = box.top + box.height * 0.58;
  const ink = onColor(brand.primary, brand);
  const d = display(brand);
  const flash = frame >= stopAt ? Math.max(0, 1 - (frame - stopAt) / 10) : 0;
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} grain={m.grain} glowStrength={m.glow + t * 0.3} />
      <div style={{ position: "absolute", top: box.top, left: box.left, width: box.width, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        {lines.slice(0, 2).map((line, index) => (
          <KineticText key={index} text={line} delay={Math.round(tl.lines * D) + index * 8} size={index === 0 ? 92 : 68} color={index === 0 ? ink : brand.accent} font={d.font} weight={d.weight} maxWidth={box.width} motion={m} />
        ))}
      </div>
      <svg style={{ position: "absolute", left: cx - R - 20, top: cy - R - 20, overflow: "visible", transform: `translateX(${shake}px) scale(${0.7 + enter * 0.3})` }} width={R * 2 + 40} height={R * 2 + 40}>
        <g transform={`translate(${R + 20} ${R + 20})`}>
          <circle r={R} fill={brand.dark} fillOpacity={0.35} stroke={brand.accent} strokeWidth={10} />
          {Array.from({ length: 60 }, (_, i) => {
            const major = i % 5 === 0;
            const a = (i / 60) * Math.PI * 2;
            return <line key={i} x1={Math.sin(a) * (R - (major ? 42 : 24))} y1={-Math.cos(a) * (R - (major ? 42 : 24))} x2={Math.sin(a) * (R - 14)} y2={-Math.cos(a) * (R - 14)} stroke={ink} strokeOpacity={major ? 0.9 : 0.35} strokeWidth={major ? 8 : 3} strokeLinecap="round" />;
          })}
          {/* Rastro do ponteiro rápido: a sensação de tempo escapando. */}
          {[0.08, 0.16, 0.24].map((lag, i) => (
            <line key={i} x1={0} y1={0} x2={0} y2={-R * 0.78} stroke={brand.accent} strokeOpacity={Math.max(0, t - 0.25) * (0.5 - i * 0.14)} strokeWidth={12} strokeLinecap="round" transform={`rotate(${minuteDeg - lag * 360 * t * 3})`} />
          ))}
          <line x1={0} y1={R * 0.12} x2={0} y2={-R * 0.5} stroke={ink} strokeWidth={18} strokeLinecap="round" transform={`rotate(${hourDeg})`} />
          <line x1={0} y1={R * 0.16} x2={0} y2={-R * 0.8} stroke={brand.accent} strokeWidth={11} strokeLinecap="round" transform={`rotate(${minuteDeg + (1 - jolt) * (frame >= stopAt ? 8 : 0)})`} />
          <circle r={18} fill={brand.accent} />
        </g>
      </svg>
      {label ? (
        <div style={{ position: "absolute", left: box.left, width: box.width, top: cy + R + 60, display: "flex", justifyContent: "center", opacity: progress(frame, stopAt, stopAt + 10, m.out) }}>
          <div style={{ background: brand.accent, color: onColor(brand.accent, brand), fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 56, padding: "12px 34px", borderRadius: m.radius >= 20 ? 999 : m.radius, textTransform: m.upper ? "uppercase" : "none" }}>{label}</div>
        </div>
      ) : null}
      <AbsoluteFill style={{ background: "#FFFFFF", opacity: flash * 0.35, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------- número

/** "70%", "3", "24h", "R$ 19,90" → prefixo, valor numérico, casas decimais e sufixo (o texto exato da pauta). */
export function parseFigure(value: string): { prefix: string; number: number; decimals: number; suffix: string; comma: boolean } | undefined {
  const match = value.trim().match(/^(\D*?)(\d+(?:[.,]\d+)?)(.*)$/);
  if (!match) return undefined;
  const raw = match[2]!;
  const comma = raw.includes(",");
  const decimals = raw.includes(",") || raw.includes(".") ? raw.split(/[.,]/)[1]!.length : 0;
  return { prefix: match[1] ?? "", number: Number(raw.replace(",", ".")), decimals, suffix: match[3] ?? "", comma };
}

/** Número animado: sobe do zero até o valor EXATO da pauta, com anel de progresso; o texto diz o que ele significa. */
export type CounterProps = Common & { value: string; lines: string[] };

export const Counter: React.FC<CounterProps> = ({ brand, value, lines, motion: motionProps, safe, timeline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const tl = { count: 0.08, land: 0.55, lines: 0.6, ...timeline };
  const figure = parseFigure(value);
  const p = progress(frame, tl.count * D, tl.land * D, m.out);
  const shown = figure ? `${figure.prefix}${(figure.number * p).toFixed(figure.decimals).replace(".", figure.comma ? "," : ".")}${figure.suffix}` : value;
  const landed = progress(frame, tl.land * D, tl.land * D + 8, m.out);
  const R = Math.min(box.width * 0.44, box.height * 0.26);
  const cy = box.top + box.height * 0.36;
  const ink = onColor(brand.primary, brand);
  const d = display(brand);
  const C = 2 * Math.PI * (R - 14);
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} grain={m.grain} glowStrength={m.glow} />
      <svg style={{ position: "absolute", left: width / 2 - R, top: cy - R }} width={R * 2} height={R * 2}>
        <circle cx={R} cy={R} r={R - 14} fill="none" stroke={ink} strokeOpacity={0.12} strokeWidth={22} />
        <circle cx={R} cy={R} r={R - 14} fill="none" stroke={brand.accent} strokeWidth={22} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={(1 - p) * C} transform={`rotate(-90 ${R} ${R})`} />
      </svg>
      <div style={{ position: "absolute", left: 0, width, top: cy - R * 0.42, display: "flex", justifyContent: "center" }}>
        <div style={{ fontFamily: d.font, fontWeight: d.weight, fontSize: Math.min(R * 0.95, 1400 / Math.max(2, shown.length)), color: ink, transform: `scale(${1 + landed * 0.08 - Math.max(0, landed - 0.5) * 0.16})`, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{shown}</div>
      </div>
      <div style={{ position: "absolute", top: cy + R + 50, left: box.left, width: box.width, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        {lines.slice(0, 2).map((line, index) => (
          <KineticText key={index} text={line} delay={Math.round(tl.lines * D) + index * 6} size={index === 0 ? 76 : 60} color={index === 0 ? ink : brand.accent} font={d.font} weight={d.weight} maxWidth={box.width} motion={m} />
        ))}
        <div style={{ height: 14 }} />
        <AccentBar delay={Math.round(tl.lines * D) + 6} width={140} height={7} color={brand.accent} />
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------- comparação

/** Comparação dinâmica: dois lados; o lado bom avança e toma o quadro (a virada da comparação). */
export type VersusProps = Common & { left: string; right: string; kicker?: string };

export const Versus: React.FC<VersusProps> = ({ brand, left, right, kicker, motion: motionProps, safe, timeline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D, fps } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const tl = { split: 0.04, take: 0.5, win: 0.72, ...timeline };
  const split = progress(frame, tl.split * D, tl.split * D + 14, m.out);
  const take = progress(frame, tl.take * D, tl.win * D, m.inOut);
  const win = spring({ frame: frame - Math.round(tl.win * D), fps, config: m.spring });
  // Divisória diagonal: começa no meio e varre para a esquerda quando o lado bom toma o quadro.
  const edge = interpolate(take, [0, 1], [0.5, -0.12]);
  const dark = brand.dark;
  const lit = brand.primary;
  const d = display(brand);
  const tilt = 0.08;
  const poly = (x: number) => `polygon(${(x + tilt) * 100}% 0, 100% 0, 100% 100%, ${(x - tilt) * 100}% 100%)`;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: dark }}>
        <div style={{ position: "absolute", left: box.left, top: box.top + box.height * 0.3, width: box.width * 0.44, opacity: split * (1 - take * 0.9), transform: `translateX(${-take * 80}px)` }}>
          <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 72, color: "#FFFFFF", opacity: 0.55, lineHeight: 1, marginBottom: 16 }}>✕</div>
          <div style={{ fontFamily: d.font, fontWeight: d.weight, fontSize: 70, lineHeight: 1.02, color: "#FFFFFF", opacity: 0.75, textDecoration: take > 0.2 ? "line-through" : "none", textDecorationColor: brand.accent, textDecorationThickness: 6 }}>{left}</div>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ clipPath: poly(edge + (1 - split) * 0.6) }}>
        <Atmosphere color={lit} glow={brand.accent} grain={m.grain} glowStrength={m.glow + take * 0.3} />
        <div style={{ position: "absolute", right: box.width * 0.02 + (width - box.right), left: interpolate(take, [0, 1], [width * 0.56, box.left]), top: box.top + box.height * (0.3 - take * 0.06), opacity: split }}>
          <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 80, color: brand.accent, lineHeight: 1, marginBottom: 16, transform: `scale(${1 + win * 0.2})`, transformOrigin: "left center" }}>✓</div>
          <div style={{ fontFamily: d.font, fontWeight: d.weight, fontSize: interpolate(take, [0, 1], [70, 104]), lineHeight: 1.02, color: onColor(lit, brand) }}>{right}</div>
        </div>
        <LightSweep start={Math.round(tl.win * D)} duration={22} intensity={0.18} />
      </AbsoluteFill>
      {kicker ? (
        <div style={{ position: "absolute", top: box.top, left: box.left, width: box.width, display: "flex", justifyContent: "center" }}>
          <KineticText text={kicker} delay={2} size={52} color={brand.accent} font="Barlow Condensed" stagger={2} motion={m} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------- revelação por máscara

/** Revelação: a imagem (metáfora gerada, produto ou referência) surge por uma máscara que se abre, em camadas com paralaxe. */
export type MaskRevealProps = Common & { photo: string; photoAspect: number; headline?: string; kicker?: string };

export const MaskReveal: React.FC<MaskRevealProps> = ({ brand, photo, photoAspect, headline, kicker, motion: motionProps, safe, timeline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const tl = { open: 0.08, full: 0.5, text: 0.42, ...timeline };
  const open = progress(frame, tl.open * D, tl.full * D, m.inOut);
  const drift = progress(frame, 0, D, m.inOut);
  const amp = m.intensity;
  const maxR = Math.hypot(width, height) / 2;
  const radius = interpolate(open, [0, 1], [0, maxR * 1.05]);
  // Anéis da marca acompanham a borda da máscara (camada da frente, paralaxe mais rápida).
  const ring = (k: number) => radius * (1 + k * 0.08) + drift * 30 * k * amp;
  const imgW = photoAspect >= width / height ? height * photoAspect : width;
  const imgH = imgW / photoAspect;
  const d = display(brand);
  const textIn = progress(frame, tl.text * D, tl.text * D + 16, m.out);
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.dark} glow={brand.primary} grain={m.grain} glowStrength={m.glow} />
      {/* Fundo: a mesma imagem, desfocada e lenta (camada de trás). */}
      <Img src={photo} style={{ position: "absolute", left: (width - imgW) / 2, top: (height - imgH) / 2, width: imgW, height: imgH, objectFit: "cover", filter: "blur(40px) brightness(0.45)", opacity: open, transform: `scale(${1.15 + drift * 0.04 * amp})` }} />
      {/* Imagem nítida dentro da máscara circular (camada do meio). */}
      <div style={{ position: "absolute", inset: 0, clipPath: `circle(${radius}px at 50% 46%)` }}>
        <Img src={photo} style={{ position: "absolute", left: (width - imgW) / 2 - drift * 24 * amp, top: (height - imgH) / 2, width: imgW, height: imgH, objectFit: "cover", transform: `scale(${1.12 - open * 0.08 + drift * 0.05 * amp})` }} />
        <LightSweep start={Math.round(tl.full * D) - 6} duration={24} intensity={0.16} />
      </div>
      <svg style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }} width={width} height={height}>
        {[1, 2].map((k) => <circle key={k} cx={width / 2} cy={height * 0.46} r={ring(k)} fill="none" stroke={brand.accent} strokeOpacity={(1 - open) * 0.9 + 0.1} strokeWidth={k === 1 ? 8 : 3} />)}
      </svg>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${brand.dark}00 52%, ${brand.dark}D9 100%)`, opacity: textIn }} />
      <div style={{ position: "absolute", left: box.left, width: box.width, bottom: height - box.bottom + 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, opacity: textIn }}>
        {kicker ? <KineticText text={kicker} delay={Math.round(tl.text * D)} size={40} color={brand.accent} font="Barlow Condensed" stagger={2} motion={m} /> : null}
        {headline ? <KineticText text={headline} delay={Math.round(tl.text * D) + 4} size={84} color="#FFFFFF" font={d.font} weight={d.weight} maxWidth={box.width} motion={m} /> : null}
      </div>
    </AbsoluteFill>
  );
};
