import React from "react";
import { AbsoluteFill, Img, interpolate, OffthreadVideo, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AccentBar, Atmosphere, KineticText, onColor, progress, type Common, type Region } from "../lib/theme";
import { resolveMotion, safeBox } from "../lib/motion";
import { softwareFocusLayout } from "../lib/layout";

/**
 * Foco em software: a captura REAL fica inteira e nítida; o cursor vai até a função, clica, e uma LUPA
 * (aproximação localizada) cresce a partir da própria região, ligada a ela por guias. Nada é escurecido
 * a ponto de perder leitura.
 */
export type SoftwareFocusProps = Common & { screenshot: string; shotAspect: number; shotWidth?: number; region: Region; label: string; headline?: string };

export const SoftwareFocus: React.FC<SoftwareFocusProps> = ({ brand, screenshot, shotAspect, shotWidth, region, label, headline, motion: motionProps, safe, timeline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D, fps } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const tl = { moveStart: 0.12, click: 0.32, zoomStart: 0.38, zoomEnd: 0.6, callout: 0.58, ...timeline };
  // Espaço do rótulo reservado ABAIXO da lupa (nada sobrepõe a tela ampliada).
  const labelSpace = 110;
  const layout = softwareFocusLayout(shotAspect, region, { ...box, bottom: box.bottom - labelSpace, height: box.height - labelSpace }, headline ? 170 : 0, 36, shotWidth);
  const { card, loupe, crop, view } = layout;
  const enter = spring({ frame, fps, config: m.spring });
  const move = progress(frame, tl.moveStart * D, tl.click * D, m.inOut);
  const click = progress(frame, tl.click * D, tl.click * D + fps * 0.35, m.out);
  const grow = progress(frame, tl.zoomStart * D, tl.zoomEnd * D, m.inOut);
  const labelIn = progress(frame, tl.callout * D, tl.callout * D + 14, m.out);
  // Região (com margem de contexto) em pixels da captura no quadro.
  const rx = card.x + crop.x * card.w;
  const ry = card.y + crop.y * card.h;
  const rw = crop.w * card.w;
  const rh = crop.h * card.h;
  // Visor: a janela que a lupa mostra; se a região é maior que a janela, ela anda acompanhando a leitura.
  const pan = progress(frame, tl.zoomEnd * D, 0.94 * D, m.inOut);
  const viewX = view.x0 + (view.x1 - view.x0) * pan;
  const vx = card.x + viewX * card.w;
  const vy = card.y + view.y * card.h;
  const vw = view.w * card.w;
  const vh = view.h * card.h;
  // A lupa nasce em cima do visor e cresce até o lugar dela (continuidade visual, não um corte).
  const lx = interpolate(grow, [0, 1], [vx, loupe.x]);
  const ly = interpolate(grow, [0, 1], [vy, loupe.y]);
  const lw = interpolate(grow, [0, 1], [vw, loupe.w]);
  const lh = interpolate(grow, [0, 1], [vh, loupe.h]);
  const imgW = lw / view.w;
  const imgH = imgW / shotAspect;
  const cursorX = interpolate(move, [0, 1], [card.x + card.w * 0.92, rx + rw / 2]);
  const cursorY = interpolate(move, [0, 1], [card.y + card.h * 1.05, ry + rh / 2]) - Math.sin(move * Math.PI) * card.h * 0.1;
  const camera = progress(frame, 0, D, m.inOut);
  return (
    <AbsoluteFill>
      <Atmosphere color={brand.primary} glow={brand.accent} grain={m.grain} glowStrength={m.glow} />
      <div style={{ position: "absolute", left: card.x, top: card.y, width: card.w, height: card.h, perspective: 1600 }}>
        <div style={{ position: "absolute", inset: 0, transform: `translateY(${(1 - enter) * 120}px) rotateX(${(1 - enter) * 18}deg) scale(${1 + camera * 0.02 * m.intensity})`, opacity: enter, borderRadius: Math.min(22, m.radius), overflow: "hidden", boxShadow: "0 36px 80px rgba(0,0,0,0.45)", border: "2px solid rgba(255,255,255,0.12)" }}>
          <Img src={screenshot} style={{ width: "100%", height: "100%", objectFit: "cover", filter: `brightness(${1 - grow * 0.12})` }} />
        </div>
      </div>
      {/* Contorno da função na captura (fica visível para ligar a lupa ao contexto). */}
      <div style={{ position: "absolute", left: rx, top: ry, width: rw, height: rh, borderRadius: 10, border: `3px solid ${brand.accent}`, opacity: click > 0 ? (grow > 0 ? 0.45 : 1) : 0, boxShadow: `0 0 ${20 + 20 * m.glow}px ${brand.accent}66` }} />
      {grow > 0 ? <div style={{ position: "absolute", left: vx, top: vy, width: vw, height: vh, borderRadius: 6, border: `4px solid ${brand.accent}`, background: `${brand.accent}14` }} /> : null}
      {grow > 0 ? (
        <>
          <svg style={{ position: "absolute", inset: 0, overflow: "visible" }} width={width} height={height}>
            <line x1={vx} y1={vy + vh} x2={lx} y2={ly} stroke={brand.accent} strokeOpacity={0.7 * grow} strokeWidth={3} />
            <line x1={vx + vw} y1={vy + vh} x2={lx + lw} y2={ly} stroke={brand.accent} strokeOpacity={0.7 * grow} strokeWidth={3} />
          </svg>
          <div style={{ position: "absolute", left: lx, top: ly, width: lw, height: lh, borderRadius: Math.min(18, m.radius), overflow: "hidden", border: `3px solid ${brand.accent}`, boxShadow: "0 30px 70px rgba(0,0,0,0.5)", background: "#000" }}>
            {/* A mesma captura, ampliada só na região: pixels originais, nenhuma recriação. */}
            <Img src={screenshot} style={{ position: "absolute", width: imgW, height: imgH, left: -viewX * imgW, top: -view.y * imgH, maxWidth: "none" }} />
          </div>
        </>
      ) : null}
      <svg style={{ position: "absolute", left: cursorX - 6, top: cursorY - 4, overflow: "visible", opacity: 1 - grow }} width={44} height={56}>
        <circle cx={6} cy={4} r={10 + click * 60} fill="none" stroke={brand.accent} strokeWidth={4} opacity={click > 0 ? 1 - click : 0} />
        <path d="M0 0 L0 40 L11 30 L19 48 L26 45 L18 27 L32 27 Z" fill="#fff" stroke="#111" strokeWidth={2.5} transform={`scale(${click > 0 && click < 0.4 ? 0.88 : 1})`} />
      </svg>
      <div style={{ position: "absolute", left: box.left, width: box.width, top: loupe.y + loupe.h + 24, display: "flex", justifyContent: "center", opacity: labelIn, transform: `translateY(${(1 - labelIn) * 24}px)` }}>
        <div style={{ background: brand.accent, color: onColor(brand.accent, brand), fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 52, padding: "12px 28px", borderRadius: Math.min(16, m.radius), textAlign: "center", textTransform: m.upper ? "uppercase" : "none", letterSpacing: `${m.letterSpacing}em`, boxShadow: "0 16px 40px rgba(0,0,0,0.35)" }}>{label}</div>
      </div>
      {headline ? (
        <div style={{ position: "absolute", top: box.top, left: box.left, width: box.width, display: "flex", justifyContent: "center" }}>
          <KineticText text={headline} delay={6} size={92} color={onColor(brand.primary, brand)} font="Barlow Condensed" maxWidth={box.width} motion={m} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Abertura/encerramento: tipografia cinética, forma gráfica desenhada, logo e chamada (estilo da marca). */
export type TitleCardProps = Common & { lines: string[]; cta?: string; logo?: string; background?: "primary" | "light" };

export const TitleCard: React.FC<TitleCardProps> = ({ brand, lines, cta, logo, background = "primary", motion: motionProps, safe, timeline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D, fps } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const tl = { lines: 0.05, cta: 0.45, ...timeline };
  const bg = background === "light" ? brand.light : brand.primary;
  const ink = onColor(bg, brand);
  const ring = progress(frame, 0, Math.max(20, D * 0.35), m.out);
  const logoIn = spring({ frame: frame - Math.round(lines.length * 6 + 6), fps, config: m.spring });
  const ctaIn = spring({ frame: frame - Math.round(tl.cta * D), fps, config: m.spring });
  const R = box.width * 0.42;
  const start = Math.round(tl.lines * D);
  return (
    <AbsoluteFill>
      <Atmosphere color={bg} glow={brand.accent} grain={m.grain} glowStrength={m.glow} />
      <svg style={{ position: "absolute", left: width / 2 - R, top: box.top + box.height * 0.36 - R }} width={R * 2} height={R * 2}>
        <circle cx={R} cy={R} r={R - 6} fill="none" stroke={brand.accent} strokeOpacity={0.45} strokeWidth={4} strokeDasharray={2 * Math.PI * R} strokeDashoffset={(1 - ring) * 2 * Math.PI * R} transform={`rotate(-90 ${R} ${R})`} />
      </svg>
      <div style={{ position: "absolute", top: box.top + box.height * 0.16, left: box.left, width: box.width, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        {lines.map((line, index) => (
          <KineticText key={index} text={line} delay={start + index * 6} size={index === 0 ? 124 : 92} color={index === 0 ? ink : brand.accent} font={brand.display} weight={brand.display === "DM Serif Display" ? 400 : 700} maxWidth={box.width} motion={m} />
        ))}
        <div style={{ height: 22 }} />
        <AccentBar delay={start + 6} width={150} height={7} color={brand.accent} />
      </div>
      {logo ? <Img src={logo} style={{ position: "absolute", left: width / 2 - box.width * 0.24, top: box.top + box.height * 0.58, width: box.width * 0.48, objectFit: "contain", opacity: logoIn, transform: `scale(${0.88 + logoIn * 0.12})` }} /> : null}
      {cta ? (
        <div style={{ position: "absolute", top: box.bottom - 130, left: box.left, width: box.width, display: "flex", justifyContent: "center" }}>
          <div style={{ transform: `scale(${ctaIn})`, background: brand.accent, color: onColor(brand.accent, brand), fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 60, padding: "16px 42px", borderRadius: m.radius >= 20 ? 999 : m.radius, textTransform: m.upper ? "uppercase" : "none", letterSpacing: `${m.letterSpacing}em`, boxShadow: "0 22px 56px rgba(0,0,0,0.35)" }}>{cta}</div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Fala com legendas dinâmicas e REENQUADRAMENTO INTELIGENTE: o recorte acompanha a região de interesse
 * (trilha suave calculada no worker). Gravação de tela ocupa a janela de cima; legendas e destaques ficam
 * na faixa da marca, sem cobrir a tela. Pessoa falando ocupa o quadro inteiro.
 */
export type Word = { text: string; start: number; end: number };
export type ReframeKey = { t: number; cx: number; cy: number; zoom: number };
export type SpeechCaptionsProps = Common & { video: string; sourceStart: number; words: Word[]; emphasis?: string[]; fit?: "cover" | "contain" | "reframe"; region?: Region; videoAspect: number; reframe?: ReframeKey[]; reframeAspect?: number; screen?: boolean };

const norm = (word: string) => word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9%]/g, "");

function keyAt(keys: ReframeKey[], t: number): ReframeKey {
  if (t <= keys[0]!.t) return keys[0]!;
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i]!.t) {
      const a = keys[i - 1]!;
      const b = keys[i]!;
      const f = (t - a.t) / Math.max(1e-3, b.t - a.t);
      return { t, cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f, zoom: a.zoom + (b.zoom - a.zoom) * f };
    }
  }
  return keys[keys.length - 1]!;
}

export const SpeechCaptions: React.FC<SpeechCaptionsProps> = ({ brand, video, sourceStart, words, emphasis = [], fit = "cover", region, videoAspect, reframe, reframeAspect, screen, motion: motionProps, safe }) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const m = resolveMotion(motionProps);
  const box = safeBox(safe, width, height);
  const t = frame / fps;
  const keys = new Set(emphasis.map(norm));
  const phrases: Word[][] = [];
  for (const word of words) {
    const last = phrases[phrases.length - 1];
    if (!last || last.length >= 4 || /[.,!?;:]$/.test(last[last.length - 1]!.text)) phrases.push([word]);
    else last.push(word);
  }
  const phrase = phrases.find((p) => t >= p[0]!.start - 0.05 && t <= p[p.length - 1]!.end + 0.25);
  const active = words.find((w) => t >= w.start && t < w.end);
  const keyWord = [...words].reverse().find((w) => keys.has(norm(w.text)) && t >= w.start && t < w.start + 1.6);
  const keyIn = keyWord ? progress(frame, keyWord.start * fps, keyWord.start * fps + 8, m.out) : 0;
  const isScreen = screen ?? fit !== "cover";
  // Janela do vídeo: tela = faixa de cima (legendas embaixo, fora da tela); pessoa = quadro inteiro.
  const winTop = isScreen ? box.top : 0;
  // Janela da tela: a proporção vem da trilha de reenquadramento (mesma conta do worker); sem trilha, 50%.
  const winH = isScreen ? (reframeAspect ? width / reframeAspect : height * 0.5) : height;
  const winW = isScreen ? width : width;
  let videoStyle: React.CSSProperties;
  if (fit === "reframe" && reframe?.length) {
    const k = keyAt(reframe, t);
    const h = winH * k.zoom;
    const w = h * videoAspect;
    videoStyle = { position: "absolute", height: h, width: w, left: winW / 2 - k.cx * w, top: winH / 2 - k.cy * h, maxWidth: "none" };
  } else if (fit === "contain") {
    const w = winW * 0.94;
    videoStyle = { position: "absolute", width: w, left: (winW - w) / 2, top: (winH - w / videoAspect) / 2 };
  } else {
    videoStyle = { position: "absolute", height: winH, left: (winW - winH * videoAspect) / 2, top: 0, maxWidth: "none" };
  }
  const captionTop = isScreen ? winTop + winH + 40 : box.bottom - 260;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {isScreen ? <Atmosphere color={brand.primary} glow={brand.accent} grain={m.grain} glowStrength={m.glow} /> : null}
      <div style={{ position: "absolute", left: 0, top: winTop, width: winW, height: winH, overflow: "hidden", borderRadius: isScreen ? Math.min(20, m.radius) : 0, boxShadow: isScreen ? "0 30px 70px rgba(0,0,0,0.45)" : undefined }}>
        <OffthreadVideo src={video} startFrom={Math.round(sourceStart * fps)} style={videoStyle} />
      </div>
      <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: (frame / durationInFrames) * width, background: brand.accent }} />
      {keyWord ? (
        <div style={{ position: "absolute", top: isScreen ? captionTop + 170 : box.top + 20, left: box.left, width: box.width, display: "flex", justifyContent: "center" }}>
          <div style={{ transform: `scale(${0.5 + keyIn * 0.5}) rotate(${(1 - keyIn) * -5 * m.intensity}deg)`, opacity: keyIn, background: brand.accent, color: onColor(brand.accent, brand), fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 80, padding: "8px 32px", borderRadius: Math.min(18, m.radius), textTransform: "uppercase", boxShadow: "0 20px 60px rgba(0,0,0,0.45)" }}>{keyWord.text.replace(/[.,!?;:]$/, "")}</div>
        </div>
      ) : null}
      {phrase ? (
        <div style={{ position: "absolute", top: captionTop, left: box.left, width: box.width, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 12px" }}>
          {phrase.map((word, index) => {
            const isActive = active === word;
            const spoken = t >= word.start;
            const pop = progress(frame, word.start * fps, word.start * fps + 5, m.out);
            const key = keys.has(norm(word.text));
            return (
              <span key={index} style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: key ? 84 : 74, textTransform: "uppercase", color: key && spoken ? brand.accent : "#fff", opacity: spoken ? 1 : 0.5, padding: "2px 12px", borderRadius: 10,
                background: isActive ? "rgba(0,0,0,0.78)" : "rgba(0,0,0,0.42)", transform: `scale(${isActive ? 1 + (1 - pop) * 0.14 * m.intensity : 1})`, textShadow: "0 4px 18px rgba(0,0,0,0.6)" }}>{word.text}</span>
            );
          })}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
