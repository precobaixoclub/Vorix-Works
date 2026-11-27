import React from "react";
import { AbsoluteFill, Img, interpolate, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { AccentBar, Atmosphere, KineticText, easeInOut, onColor, progress, useSpring, type Common, type Region } from "../lib/theme";

/** Foco em software: captura REAL em perspectiva, cursor até a função, clique, holofote e callout. */
export type SoftwareFocusProps = Common & { screenshot: string; shotAspect: number; region: Region; label: string; headline?: string };

export const SoftwareFocus: React.FC<SoftwareFocusProps> = ({ brand, screenshot, shotAspect, region, label, headline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames, fps } = useVideoConfig();
  const D = durationInFrames;
  const enter = useSpring(0, { damping: 22, stiffness: 80 });
  const cardW = Math.min(width * 0.92, height * 0.62 * shotAspect);
  const cardH = cardW / shotAspect;
  const baseLeft = (width - cardW) / 2;
  const baseTop = height * 0.55 - cardH / 2;
  // Cursor vai até o centro da função; clique; câmera aproxima até a função ocupar ~86% da largura.
  const cx = (region.x + region.w / 2) * cardW;
  const cy = (region.y + region.h / 2) * cardH;
  const move = progress(frame, D * 0.14, D * 0.36, easeInOut);
  const click = progress(frame, D * 0.36, D * 0.36 + fps * 0.35);
  const zoom = progress(frame, D * 0.42, D * 0.66, easeInOut);
  const targetScale = Math.min(2.8, (width * 0.86) / (region.w * cardW));
  const scale = interpolate(zoom, [0, 1], [1, targetScale]);
  const tx = interpolate(zoom, [0, 1], [0, (cardW / 2 - cx) * targetScale]);
  const ty = interpolate(zoom, [0, 1], [0, (cardH / 2 - cy) * targetScale]);
  const spotlight = progress(frame, D * 0.5, D * 0.66);
  const callout = progress(frame, D * 0.64, D * 0.64 + 14);
  const cursorX = interpolate(move, [0, 1], [cardW * 0.92, cx]);
  const cursorY = interpolate(move, [0, 1], [cardH * 1.05, cy]) - Math.sin(move * Math.PI) * cardH * 0.12;
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} />
      <div style={{ position: "absolute", left: baseLeft, top: baseTop, width: cardW, height: cardH, perspective: 1600 }}>
        <div style={{ position: "absolute", inset: 0, transform: `translate(${tx}px, ${ty + (1 - enter) * 160}px) scale(${scale}) rotateX(${(1 - enter) * 22}deg)`, transformOrigin: "50% 50%", opacity: enter }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: 22, overflow: "hidden", boxShadow: "0 40px 90px rgba(0,0,0,0.5)", border: "2px solid rgba(255,255,255,0.12)" }}>
            <Img src={screenshot} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          {/* Holofote: escurece tudo menos o componente (a tela em si não é alterada). */}
          <div style={{ position: "absolute", left: region.x * cardW, top: region.y * cardH, width: region.w * cardW, height: region.h * cardH, borderRadius: 14 / scale, boxShadow: `0 0 0 ${4000}px rgba(0,0,0,${0.55 * spotlight}), 0 0 0 ${4 / scale}px ${brand.accent}`, opacity: spotlight > 0 ? 1 : 0 }} />
          {/* Cursor e clique (some quando a câmera aproxima). */}
          <svg style={{ position: "absolute", left: cursorX - 6, top: cursorY - 4, overflow: "visible", opacity: 1 - zoom }} width={44} height={56}>
            <circle cx={6} cy={4} r={10 + click * 60} fill="none" stroke={brand.accent} strokeWidth={4} opacity={click > 0 ? 1 - click : 0} />
            <path d="M0 0 L0 40 L11 30 L19 48 L26 45 L18 27 L32 27 Z" fill="#fff" stroke="#111" strokeWidth={2.5} transform={`scale(${1 - click * 0.15 + (click > 0.6 ? 0.15 : 0)})`} />
          </svg>
        </div>
      </div>
      <div style={{ position: "absolute", left: width * 0.08, right: width * 0.08, bottom: height * 0.07, display: "flex", justifyContent: "center", opacity: callout, transform: `translateY(${(1 - callout) * 40}px)` }}>
        <div style={{ background: brand.accent, color: onColor(brand.accent, brand), fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 62, padding: "16px 34px", borderRadius: 18, textAlign: "center", textTransform: "uppercase", boxShadow: "0 20px 50px rgba(0,0,0,0.4)" }}>{label}</div>
      </div>
      {headline ? (
        <div style={{ position: "absolute", top: height * 0.07, left: width * 0.07, right: width * 0.07, display: "flex", justifyContent: "center", opacity: 1 - zoom * 0.85 }}>
          <KineticText text={headline} delay={6} size={104} color={onColor(brand.primary, brand)} font="Barlow Condensed" maxWidth={width * 0.86} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Abertura/encerramento: tipografia cinética, forma gráfica desenhada, logo e chamada. */
export type TitleCardProps = Common & { lines: string[]; cta?: string; logo?: string; background?: "primary" | "light" };

export const TitleCard: React.FC<TitleCardProps> = ({ brand, lines, cta, logo, background = "primary" }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const bg = background === "light" ? brand.light : brand.primary;
  const ink = onColor(bg, brand);
  const ring = progress(frame, 0, 30);
  const logoIn = useSpring(Math.round(lines.length * 6 + 6), { damping: 16 });
  const ctaIn = useSpring(Math.round(durationInFrames * 0.45), { damping: 12, stiffness: 140 });
  const R = width * 0.36;
  return (
    <AbsoluteFill>
      <Atmosphere color={bg} glow={brand.accent} />
      <svg style={{ position: "absolute", left: width / 2 - R, top: height * 0.42 - R }} width={R * 2} height={R * 2}>
        <circle cx={R} cy={R} r={R - 6} fill="none" stroke={brand.accent} strokeOpacity={0.5} strokeWidth={4} strokeDasharray={2 * Math.PI * R} strokeDashoffset={(1 - ring) * 2 * Math.PI * R} transform={`rotate(-90 ${R} ${R})`} />
      </svg>
      <div style={{ position: "absolute", top: height * 0.24, left: width * 0.08, right: width * 0.08, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        {lines.map((line, index) => (
          <KineticText key={index} text={line} delay={4 + index * 6} size={index === 0 ? 132 : 96} color={index === 0 ? ink : brand.accent} font={brand.display} weight={brand.display === "DM Serif Display" ? 400 : 700} maxWidth={width * 0.86} />
        ))}
        <div style={{ height: 24 }} />
        <AccentBar delay={10} width={160} height={8} color={brand.accent} />
      </div>
      {logo ? <Img src={logo} style={{ position: "absolute", left: width / 2 - width * 0.22, top: height * 0.6, width: width * 0.44, objectFit: "contain", opacity: logoIn, transform: `scale(${0.85 + logoIn * 0.15})` }} /> : null}
      {cta ? (
        <div style={{ position: "absolute", bottom: height * 0.1, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ transform: `scale(${ctaIn})`, background: brand.accent, color: onColor(brand.accent, brand), fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 64, padding: "18px 44px", borderRadius: 999, textTransform: "uppercase", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>{cta}</div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Fala com legendas dinâmicas: palavra falada destacada, palavras-chave com ênfase e um selo contextual. */
export type Word = { text: string; start: number; end: number };
export type SpeechCaptionsProps = Common & { video: string; sourceStart: number; words: Word[]; emphasis?: string[]; fit?: "cover" | "contain"; region?: Region; videoAspect: number };

const norm = (word: string) => word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9%]/g, "");

export const SpeechCaptions: React.FC<SpeechCaptionsProps> = ({ brand, video, sourceStart, words, emphasis = [], fit = "cover", region, videoAspect }) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const keys = new Set(emphasis.map(norm));
  // Frases curtas (até 4 palavras ou pontuação): leitura confortável no celular.
  const phrases: Word[][] = [];
  for (const word of words) {
    const last = phrases[phrases.length - 1];
    if (!last || last.length >= 4 || /[.,!?;:]$/.test(last[last.length - 1]!.text)) phrases.push([word]);
    else last.push(word);
  }
  const phrase = phrases.find((p) => t >= p[0]!.start - 0.05 && t <= p[p.length - 1]!.end + 0.25);
  const active = words.find((w) => t >= w.start && t < w.end);
  const keyWord = [...words].reverse().find((w) => keys.has(norm(w.text)) && t >= w.start && t < w.start + 1.6);
  const keyIn = keyWord ? progress(frame, keyWord.start * fps, keyWord.start * fps + 8) : 0;
  // Enquadramento: gravação de tela inteira (contain) sobre fundo desfocado, ou corte pela região.
  const videoW = fit === "contain" ? width : height * videoAspect;
  const zoom = region ? Math.min(2.6, 1 / region.w) : 1;
  const videoStyle: React.CSSProperties = fit === "contain"
    ? { position: "absolute", width: width * 0.94, top: height * 0.4 - (width * 0.94) / videoAspect / 2, left: width * 0.03, borderRadius: 24, boxShadow: "0 40px 90px rgba(0,0,0,0.5)", transform: `scale(${zoom})`, transformOrigin: region ? `${(region.x + region.w / 2) * 100}% ${(region.y + region.h / 2) * 100}%` : "50% 50%" }
    : { position: "absolute", height, left: (width - videoW) / 2, top: 0 };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Gravação de tela inteira: sobre a cor da marca (desfocar uma página branca vira cinza chapado). */}
      {fit === "contain" ? <Atmosphere color={brand.primary} glow={brand.accent} /> : null}
      <OffthreadVideo src={video} startFrom={Math.round(sourceStart * fps)} style={videoStyle} />
      <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: (frame / durationInFrames) * width, background: brand.accent }} />
      {keyWord ? (
        <div style={{ position: "absolute", top: height * 0.12, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ transform: `scale(${0.5 + keyIn * 0.5}) rotate(${(1 - keyIn) * -6}deg)`, opacity: keyIn, background: brand.accent, color: onColor(brand.accent, brand), fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 88, padding: "10px 36px", borderRadius: 18, textTransform: "uppercase", boxShadow: "0 20px 60px rgba(0,0,0,0.45)" }}>{keyWord.text.replace(/[.,!?;:]$/, "")}</div>
        </div>
      ) : null}
      {phrase ? (
        <div style={{ position: "absolute", bottom: height * 0.17, left: width * 0.06, right: width * 0.06, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 14px" }}>
          {phrase.map((word, index) => {
            const isActive = active === word;
            const spoken = t >= word.start;
            const pop = progress(frame, word.start * fps, word.start * fps + 5);
            const key = keys.has(norm(word.text));
            return (
              <span key={index} style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: key ? 92 : 80, textTransform: "uppercase", color: key && spoken ? brand.accent : "#fff", opacity: spoken ? 1 : 0.45, padding: "2px 14px", borderRadius: 12,
                background: isActive ? `rgba(0,0,0,0.78)` : "rgba(0,0,0,0.45)", transform: `scale(${isActive ? 1 + (1 - pop) * 0.18 : 1})`, textShadow: "0 4px 18px rgba(0,0,0,0.6)" }}>{word.text}</span>
            );
          })}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
