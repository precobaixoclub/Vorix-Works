import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AccentBar, Atmosphere, KineticText, LightSweep, onColor, progress, type Common, type Region } from "../lib/theme";
import { resolveMotion, safeBox } from "../lib/motion";
import { lineupRects } from "../lib/layout";

const display = (brand: Common["brand"]) => ({ font: brand.display, weight: brand.display === "DM Serif Display" ? 400 : 700 });

/** Produto herói: a foto ORIGINAL entra por máscara; câmera contínua com intenção; callout desenhado na estampa. */
export type ProductHeroProps = Common & { backdrop?: string; photo: string; photoAspect: number; kicker?: string; headline?: string; detail?: Region; detailLabel?: string };

export const ProductHero: React.FC<ProductHeroProps> = ({ brand, backdrop, photo, photoAspect, kicker, headline, detail, detailLabel, motion: motionProps, safe, timeline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D, fps } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const tl = { reveal: 0.04, callout: 0.45, ...timeline };
  const enter = spring({ frame: frame - Math.round(tl.reveal * D), fps, config: m.spring });
  const reveal = progress(frame, tl.reveal * D, tl.reveal * D + 18, m.out);
  const camera = progress(frame, 0, D, m.inOut);
  const titleH = headline ? (m.airy ? 300 : 260) : 0;
  // Cartão no espaço útil abaixo do título, sem invadir as áreas da interface da plataforma.
  const availH = box.bottom - (box.top + titleH) - 20;
  const cardW = Math.min(box.width * (m.airy ? 0.86 : 0.94), availH * photoAspect);
  const cardH = cardW / photoAspect;
  const cardTop = box.top + titleH + (availH - cardH) / 2;
  const radius = m.radius;
  const amp = m.intensity;
  const callout = detail ? progress(frame, tl.callout * D, tl.callout * D + 18, m.out) : 0;
  const text = onColor(brand.primary, brand);
  const d = display(brand);
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} grain={m.grain} glowStrength={m.glow} />
      <Img src={backdrop ?? photo} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: backdrop ? undefined : "blur(46px) brightness(0.55)", opacity: 0.55, transform: `translateX(${-camera * width * 0.04 * amp}px) scale(${1.2 + camera * 0.06 * amp})` }} />
      <div style={{ position: "absolute", left: (width - cardW) / 2, top: cardTop + (1 - enter) * 90 * amp, width: cardW, height: cardH, perspective: 1800 }}>
        <div style={{ width: "100%", height: "100%", transform: `rotateY(${interpolate(camera, [0, 1], [7 * amp, -3 * amp])}deg) rotateX(${interpolate(camera, [0, 1], [2.5 * amp, -1 * amp])}deg) scale(${1.06 - enter * 0.06 + camera * 0.025 * amp})`, transformStyle: "preserve-3d", borderRadius: radius, boxShadow: `0 ${50 * enter}px ${110 * enter}px rgba(0,0,0,0.45)`, clipPath: `inset(${(1 - reveal) * 100}% 0 0 0 round ${radius}px)`, overflow: "hidden", position: "relative" }}>
          <Img src={photo} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1 + camera * 0.05 * amp})`, transformOrigin: detail ? `${(detail.x + detail.w / 2) * 100}% ${(detail.y + detail.h / 2) * 100}%` : "50% 40%" }} />
          <LightSweep start={Math.round(tl.reveal * D) + 16} duration={26} intensity={0.12 + m.glow * 0.15} />
        </div>
        {detail ? (
          <svg style={{ position: "absolute", inset: 0, overflow: "visible" }} width={cardW} height={cardH}>
            <rect x={detail.x * cardW - 12} y={detail.y * cardH - 12} width={detail.w * cardW + 24} height={detail.h * cardH + 24} rx={Math.min(22, radius)} fill="none" stroke={brand.accent} strokeWidth={5}
              strokeDasharray={2 * (detail.w * cardW + detail.h * cardH + 48)} strokeDashoffset={(1 - callout) * 2 * (detail.w * cardW + detail.h * cardH + 48)} />
          </svg>
        ) : null}
        {detail && detailLabel ? (
          // Rótulo ABAIXO da estampa, dentro do cartão: nunca cobre o desenho nem sai da área segura.
          <div style={{ position: "absolute", left: 0, right: 0, top: Math.min(cardH - 90, (detail.y + detail.h) * cardH + 26), display: "flex", justifyContent: "center", opacity: callout, transform: `translateY(${(1 - callout) * 16}px)` }}>
            <div style={{ background: brand.accent, color: onColor(brand.accent, brand), fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 40, padding: "8px 20px", borderRadius: Math.min(14, radius), textTransform: m.upper ? "uppercase" : "none", letterSpacing: `${m.letterSpacing}em`, whiteSpace: "nowrap" }}>{detailLabel}</div>
          </div>
        ) : null}
      </div>
      <div style={{ position: "absolute", top: box.top, left: box.left, width: box.width, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        {kicker ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <AccentBar delay={6} width={60} height={5} color={brand.accent} />
            <KineticText text={kicker} delay={6} size={38} color={brand.accent} font="Barlow Condensed" stagger={2} motion={m} />
            <AccentBar delay={6} width={60} height={5} color={brand.accent} />
          </div>
        ) : null}
        {headline ? <KineticText text={headline} delay={10} size={d.font === "DM Serif Display" ? 104 : 118} color={text} font={d.font} weight={d.weight} maxWidth={box.width} motion={m} /> : null}
      </div>
    </AbsoluteFill>
  );
};

/** Detalhe que se revela: macro da estampa → peça inteira (pista → resposta), no ritmo da linha do tempo. */
export type DetailRevealProps = Common & { backdrop?: string; photo: string; photoAspect: number; detail: Region; label?: string };

export const DetailReveal: React.FC<DetailRevealProps> = ({ brand, backdrop, photo, photoAspect, detail, label, motion: motionProps, safe, timeline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const tl = { openStart: 0.38, openEnd: 0.82, label: 0.72, ...timeline };
  const labelSpace = label ? 200 : 0;
  const fitW = Math.min(box.width, (box.height - labelSpace) * photoAspect);
  const fitH = fitW / photoAspect;
  const centerY = box.top + (box.height - labelSpace) / 2;
  const macro = Math.min(3.4, (width * 0.85) / (detail.w * fitW));
  const open = progress(frame, tl.openStart * D, tl.openEnd * D, m.inOut);
  const push = progress(frame, 0, tl.openStart * D, m.out);
  const scale = interpolate(open, [0, 1], [macro * (1 + push * 0.05 * m.intensity), 1]);
  const cx = detail.x + detail.w / 2;
  const cy = detail.y + detail.h / 2;
  const tx = interpolate(open, [0, 1], [(0.5 - cx) * fitW * scale, 0]);
  const ty = interpolate(open, [0, 1], [(0.5 - cy) * fitH * scale + (height / 2 - centerY), 0]);
  const labelIn = progress(frame, tl.label * D, tl.label * D + 14, m.out);
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} grain={m.grain} glowStrength={m.glow} />
      <Img src={backdrop ?? photo} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.15)", filter: backdrop ? undefined : "blur(50px) brightness(0.5)", opacity: 0.6 * open }} />
      <div style={{ position: "absolute", left: (width - fitW) / 2, top: centerY - fitH / 2, width: fitW, height: fitH, transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "50% 50%", borderRadius: m.radius * open, overflow: "hidden", boxShadow: `0 50px 110px rgba(0,0,0,${0.45 * open})` }}>
        <Img src={photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <LightSweep start={Math.round(tl.openEnd * D) - 10} duration={24} intensity={0.1 + m.glow * 0.15} />
      </div>
      {label ? (
        <div style={{ position: "absolute", top: box.bottom - labelSpace + 30, left: box.left, width: box.width, display: "flex", justifyContent: "center", opacity: labelIn, transform: `translateY(${(1 - labelIn) * 30}px)` }}>
          <KineticText text={label} delay={Math.round(tl.label * D)} size={84} color={onColor(brand.primary, brand)} font={display(brand).font} weight={display(brand).weight} maxWidth={box.width} motion={m} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Vitrine de variantes: grade SEM sobreposição (toda estampa visível), entrada escalonada e paralaxe leve. */
export type LineupProps = Common & { photos: string[]; photoAspect: number; headline?: string; labels?: string[] };

export const Lineup: React.FC<LineupProps> = ({ brand, photos, photoAspect, headline, labels = [], motion: motionProps, safe, timeline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D, fps } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const tl = { first: 0.05, stagger: 0.1, ...timeline };
  const rects = lineupRects(Math.min(3, photos.length), photoAspect, box, headline ? 200 : 0);
  const drift = progress(frame, 0, D, m.inOut);
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} grain={m.grain} glowStrength={m.glow} />
      {rects.map((rect, index) => {
        const s = spring({ frame: frame - Math.round((tl.first + index * tl.stagger) * D), fps, config: m.spring });
        // Paralaxe: cada cartão anda a uma velocidade (profundidade) sem encostar no vizinho (gap ≥ 28 px).
        const depth = index === 0 ? 1 : 0.6;
        return (
          <div key={index} style={{ position: "absolute", left: rect.x, top: rect.y + (1 - s) * 140, width: rect.w, height: rect.h, transform: `translateY(${-drift * 12 * depth * m.intensity}px) scale(${0.94 + s * 0.06})`, borderRadius: m.radius, overflow: "hidden", boxShadow: `0 ${30 * depth}px ${70 * depth}px rgba(0,0,0,0.45)`, opacity: s }}>
            <Img src={photos[index]!} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {labels[index] ? <div style={{ position: "absolute", bottom: 14, left: 14, background: "rgba(0,0,0,0.62)", color: "#fff", fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 32, padding: "4px 14px", borderRadius: 10, textTransform: m.upper ? "uppercase" : "none" }}>{labels[index]}</div> : null}
          </div>
        );
      })}
      {headline ? (
        <div style={{ position: "absolute", top: box.top, left: box.left, width: box.width, display: "flex", justifyContent: "center" }}>
          <KineticText text={headline} delay={6} size={104} color={onColor(brand.primary, brand)} font={display(brand).font} weight={display(brand).weight} maxWidth={box.width} motion={m} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
