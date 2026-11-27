import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { AccentBar, Atmosphere, KineticText, LightSweep, easeInOut, onColor, progress, useSpring, type Common, type Region } from "../lib/theme";

/** Produto herói: a foto ORIGINAL entra por máscara, com câmera em perspectiva, reflexo e callout na estampa. */
export type ProductHeroProps = Common & { backdrop?: string; photo: string; photoAspect: number; kicker?: string; headline?: string; detail?: Region; detailLabel?: string };

export const ProductHero: React.FC<ProductHeroProps> = ({ brand, backdrop, photo, photoAspect, kicker, headline, detail, detailLabel }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const enter = useSpring(2, { damping: 20, stiffness: 90 });
  const reveal = progress(frame, 0, 20);
  const camera = progress(frame, 0, durationInFrames, easeInOut);
  const cardW = Math.min(width * 0.8, height * 0.6 * photoAspect);
  const cardH = cardW / photoAspect;
  const cardTop = height * 0.58 - cardH / 2;
  const radius = 34;
  const callout = detail ? progress(frame, durationInFrames * 0.45, durationInFrames * 0.45 + 18) : 0;
  const text = onColor(brand.primary, brand);
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} />
      {/* Fundo: a própria foto, desfocada e em outra velocidade (paralaxe real entre camadas). */}
      <Img src={backdrop ?? photo} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: backdrop ? undefined : "blur(46px) brightness(0.55) saturate(0.9)", opacity: 0.6, transform: `translateX(${-camera * width * 0.05}px) scale(${1.2 + camera * 0.08})` }} />
      <div style={{ position: "absolute", left: (width - cardW) / 2, top: cardTop + (1 - enter) * 120, width: cardW, height: cardH, perspective: 1800 }}>
        <div style={{ width: "100%", height: "100%", transform: `rotateY(${interpolate(camera, [0, 1], [9, -4])}deg) rotateX(${interpolate(camera, [0, 1], [3, -1])}deg) scale(${1.1 - enter * 0.1 + camera * 0.03})`, transformStyle: "preserve-3d", borderRadius: radius, boxShadow: `0 ${60 * enter}px ${120 * enter}px rgba(0,0,0,0.45)`, clipPath: `inset(${(1 - reveal) * 100}% 0 0 0 round ${radius}px)`, overflow: "hidden", position: "relative" }}>
          <Img src={photo} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1 + camera * 0.06})`, transformOrigin: detail ? `${(detail.x + detail.w / 2) * 100}% ${(detail.y + detail.h / 2) * 100}%` : "50% 40%" }} />
          <LightSweep start={18} duration={26} />
        </div>
        {detail ? (
          <svg style={{ position: "absolute", inset: 0, overflow: "visible" }} width={cardW} height={cardH}>
            <rect x={detail.x * cardW - 12} y={detail.y * cardH - 12} width={detail.w * cardW + 24} height={detail.h * cardH + 24} rx={22} fill="none" stroke={brand.accent} strokeWidth={5}
              strokeDasharray={2 * (detail.w * cardW + detail.h * cardH + 48)} strokeDashoffset={(1 - callout) * 2 * (detail.w * cardW + detail.h * cardH + 48)} />
            {detailLabel && callout > 0 ? (
              <g opacity={callout}>
                <line x1={(detail.x + detail.w) * cardW + 12} y1={detail.y * cardH} x2={(detail.x + detail.w) * cardW + 60} y2={detail.y * cardH - 70 * callout} stroke={brand.accent} strokeWidth={4} />
              </g>
            ) : null}
          </svg>
        ) : null}
        {detail && detailLabel ? (
          <div style={{ position: "absolute", left: Math.min(cardW - 360, (detail.x + detail.w) * cardW + 20), top: detail.y * cardH - 150, transform: `scale(${0.6 + callout * 0.4})`, opacity: callout, background: brand.accent, color: onColor(brand.accent, brand), fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 44, padding: "10px 22px", borderRadius: 14, textTransform: "uppercase", whiteSpace: "nowrap" }}>{detailLabel}</div>
        ) : null}
      </div>
      <div style={{ position: "absolute", top: height * 0.075, left: width * 0.08, right: width * 0.08, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        {kicker ? (
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <AccentBar delay={6} width={70} height={6} color={brand.accent} />
            <KineticText text={kicker} delay={6} size={40} color={brand.accent} font="Barlow Condensed" stagger={2} />
            <AccentBar delay={6} width={70} height={6} color={brand.accent} />
          </div>
        ) : null}
        {headline ? <KineticText text={headline} delay={10} size={brand.display === "DM Serif Display" ? 108 : 124} color={text} font={brand.display} weight={brand.display === "DM Serif Display" ? 400 : 700} maxWidth={width * 0.84} /> : null}
      </div>
    </AbsoluteFill>
  );
};

/** Detalhe que se revela: começa no macro da estampa e a câmera abre até a peça inteira (pista → resposta). */
export type DetailRevealProps = Common & { backdrop?: string; photo: string; photoAspect: number; detail: Region; label?: string };

export const DetailReveal: React.FC<DetailRevealProps> = ({ brand, backdrop, photo, photoAspect, detail, label }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  // Foto inteira cabe em 88% da largura; no macro, a região da estampa ocupa ~85% da largura.
  const fitW = Math.min(width * 0.88, height * 0.78 * photoAspect);
  const fitH = fitW / photoAspect;
  const macro = Math.min(3.4, (width * 0.85) / (detail.w * fitW));
  const open = progress(frame, durationInFrames * 0.38, durationInFrames * 0.82, easeInOut);
  const push = progress(frame, 0, durationInFrames * 0.4);
  const scale = interpolate(open, [0, 1], [macro * (1 + push * 0.05), 1]);
  const cx = detail.x + detail.w / 2;
  const cy = detail.y + detail.h / 2;
  // Translação que mantém o centro da estampa no centro do quadro durante o macro.
  const tx = interpolate(open, [0, 1], [(0.5 - cx) * fitW * scale, 0]);
  const ty = interpolate(open, [0, 1], [(0.5 - cy) * fitH * scale, 0]);
  const labelIn = progress(frame, durationInFrames * 0.72, durationInFrames * 0.72 + 14);
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} />
      <Img src={backdrop ?? photo} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.15)", filter: backdrop ? undefined : "blur(50px) brightness(0.5)", opacity: 0.6 * open }} />
      <div style={{ position: "absolute", left: (width - fitW) / 2, top: height * 0.46 - fitH / 2, width: fitW, height: fitH, transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "50% 50%", borderRadius: 30 * open, overflow: "hidden", boxShadow: `0 50px 110px rgba(0,0,0,${0.45 * open})` }}>
        <Img src={photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <LightSweep start={Math.round(durationInFrames * 0.6)} duration={24} />
      </div>
      {label ? (
        <div style={{ position: "absolute", bottom: height * 0.07, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: labelIn, transform: `translateY(${(1 - labelIn) * 40}px)` }}>
          <KineticText text={label} delay={Math.round(durationInFrames * 0.72)} size={92} color={onColor(brand.primary, brand)} font={brand.display} weight={brand.display === "DM Serif Display" ? 400 : 700} maxWidth={width * 0.86} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Vitrine de variantes: as fotos originais em cartões com profundidade, entrando em sequência. */
export type LineupProps = Common & { photos: string[]; photoAspect: number; headline?: string; labels?: string[] };

export const Lineup: React.FC<LineupProps> = ({ brand, photos, photoAspect, headline, labels = [] }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const pan = progress(frame, 0, durationInFrames, easeInOut);
  const n = Math.min(3, photos.length);
  const cardW = width * (n === 3 ? 0.5 : 0.62);
  const cardH = cardW / photoAspect;
  const layout = n === 3 ? [{ x: -0.3, s: 0.84, z: 1 }, { x: 0, s: 1.08, z: 3 }, { x: 0.3, s: 0.84, z: 2 }] : [{ x: -0.21, s: 0.92, z: 1 }, { x: 0.21, s: 1, z: 2 }];
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} />
      {photos.slice(0, n).map((photo, index) => {
        const slot = layout[index]!;
        const s = useSpring(4 + index * 6, { damping: 19 });
        const x = width / 2 + slot.x * width - cardW / 2 + (index - (n - 1) / 2) * -40 * pan;
        return (
          <div key={index} style={{ position: "absolute", left: x, top: height * 0.56 - cardH / 2 + (1 - s) * 260 + Math.abs(slot.x) * 80, width: cardW, height: cardH, zIndex: slot.z, transform: `scale(${slot.s * (0.9 + s * 0.1)}) rotate(${(slot.x * 14) * (1 - pan * 0.4)}deg)`, borderRadius: 30, overflow: "hidden", boxShadow: "0 50px 100px rgba(0,0,0,0.5)", opacity: s }}>
            <Img src={photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {labels[index] ? <div style={{ position: "absolute", bottom: 18, left: 18, background: "rgba(0,0,0,0.6)", color: "#fff", fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 36, padding: "6px 16px", borderRadius: 10, textTransform: "uppercase" }}>{labels[index]}</div> : null}
          </div>
        );
      })}
      {headline ? (
        <div style={{ position: "absolute", top: height * 0.08, left: width * 0.08, right: width * 0.08, display: "flex", justifyContent: "center" }}>
          <KineticText text={headline} delay={8} size={112} color={onColor(brand.primary, brand)} font={brand.display} weight={brand.display === "DM Serif Display" ? 400 : 700} maxWidth={width * 0.84} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
