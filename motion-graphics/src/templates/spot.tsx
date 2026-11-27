import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { easeInOut, luminance, progress, type Common } from "../lib/theme";
import { resolveMotion, safeBox } from "../lib/motion";
import { bandFrame, clampRect, frame as framing, imageTransform, lerpRect, lumaUnder, toScreen, type Frac, type Shot as Framing } from "../lib/camera";

/**
 * SPOT — a peça inteira numa única linha do tempo (não mais cenas isoladas coladas pelo FFmpeg).
 * Camadas persistentes (identidade, granulação, índice), transições coordenadas entre planos (a
 * entrada de um plano conversa com a saída do anterior), câmera virtual sobre a foto original e
 * tipografia por linguagem. Os tempos (planos, entradas de elementos, trocas) vêm prontos do
 * compilador do storyboard — a trilha é composta com os MESMOS números.
 */

export type SpotPhoto = { src: string; w: number; h: number; print?: Frac; name?: string; fabric?: string; luma?: { cols: number; rows: number; values: number[] } };
export type SpotCutout = { src: string; w: number; h: number; elements: Frac[]; /** Altura do traço (0–1) ao longo da largura: a ponta de luz segue a linha ao desenhar. */ trace?: number[] };
export type SpotText = { text: string; role: "headline" | "kicker" | "label" | "cta" | "body" | "caption" };
export type SpotTransition = "cut" | "color_wipe" | "mask_reveal" | "iris_print" | "match_print" | "dissolve" | "slide_up";
export type SpotShotKind = "hook_type" | "print_assemble" | "trace_draw" | "fullbleed" | "macro" | "bands" | "variant_cycle" | "countdown" | "type_card" | "logo_resolve";
export type SpotShot = {
  kind: SpotShotKind;
  from: number;
  frames: number;
  photo?: string;
  photos?: string[];
  camera?: { from: Framing; to: Framing };
  texts?: SpotText[];
  placement?: "top" | "bottom" | "center";
  field?: string;
  transition?: SpotTransition;
  transitionFrames?: number;
  transitionColor?: string;
  /** Quadros locais: entrada de cada elemento (montagem), troca de variante, revelação de faixa. */
  events?: number[];
  /** Montagem da estampa: retângulo de tela onde a estampa pousa (= posição dela no plano seguinte). */
  land?: Frac;
  /** Palavras faladas (quadros locais): a legenda acende no tempo da narração. */
  words?: { word: string; start: number; end: number }[];
  /** Colchetes de foco na estampa (plano de produto). */
  focus?: boolean;
  /** Cartão final: fotos em cartões no rodapé. */
  strip?: string[];
};
export type SpotLanguage = "editorial" | "graphic" | "cinematic";
export type SpotProps = Common & {
  language: SpotLanguage;
  shots: SpotShot[];
  photos: Record<string, SpotPhoto>;
  cutout?: SpotCutout;
  logo?: string;
  logoAspect?: number;
  /** Tom da logo oficial (escura/clara): a assinatura escolhe o fundo que a mantém legível, sem recolorir. */
  logoTone?: "dark" | "light";
  palette: { dark: string; light: string; accent: string; ink: string };
  brandLabel?: string;
  /** Ênfase das palavras *marcadas*: cor de destaque ou bloco de destaque atrás da palavra. */
  emphasis?: "color" | "block";
  /** Alinhamento dos títulos (âncora fixa da peça). */
  align?: "left" | "center";
};

type Ctx = { p: SpotProps; W: number; H: number; fps: number; box: ReturnType<typeof safeBox>; m: ReturnType<typeof resolveMotion> };

const SANS = "Geist";
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------------------------------------
// Tipografia por linguagem
// ---------------------------------------------------------------------------------------------

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const total = text.length;
  const lines = Math.max(1, Math.ceil(total / maxChars));
  const target = total / lines;
  const out: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && next.length > target * 1.18 && out.length < lines - 1) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

function typeSpec(ctx: Ctx, role: SpotText["role"]) {
  const { p } = ctx;
  const display = p.brand.display;
  const serif = display === "DM Serif Display";
  const upperDisplay = !serif;
  const lang = p.language;
  if (role === "headline") {
    const base = lang === "graphic" ? 158 : lang === "cinematic" ? 100 : 116;
    const chars = lang === "graphic" ? 11 : lang === "cinematic" ? 22 : 15;
    return { font: display, weight: serif ? 400 : 700, size: base, chars, upper: upperDisplay || lang === "graphic", tracking: lang === "cinematic" ? 0.04 : serif ? -0.015 : 0.005, lineHeight: serif ? 1.02 : 0.94, factor: serif ? 0.5 : 0.46 };
  }
  if (role === "cta") return { font: SANS, weight: 400, size: 34, chars: 40, upper: true, tracking: 0.26, lineHeight: 1.2, factor: 0.62 };
  if (role === "label") return { font: SANS, weight: 400, size: 30, chars: 30, upper: true, tracking: 0.22, lineHeight: 1.2, factor: 0.62 };
  if (role === "body") return { font: SANS, weight: 400, size: 40, chars: 26, upper: false, tracking: 0, lineHeight: 1.25, factor: 0.55 };
  return { font: SANS, weight: 400, size: lang === "cinematic" ? 26 : 30, chars: 40, upper: true, tracking: lang === "cinematic" ? 0.5 : 0.32, lineHeight: 1.2, factor: 0.64 };
}

/** Palavras marcadas com *asteriscos* são a ÊNFASE (cor de destaque ou bloco, conforme a marca). */
function tokens(text: string): { word: string; em: boolean }[] {
  const out: { word: string; em: boolean }[] = [];
  let em = false;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const opens = raw.startsWith("*");
    const closes = raw.endsWith("*") && raw.length > 1;
    if (opens) em = true;
    out.push({ word: raw.replace(/\*/g, ""), em });
    if (closes || (opens && raw.length > 1 && raw.slice(1).includes("*"))) em = false;
  }
  return out;
}

function wrapTokens(list: { word: string; em: boolean }[], maxChars: number) {
  const lines = wrap(list.map((t) => t.word).join(" "), maxChars);
  let k = 0;
  return lines.map((line) => line.split(" ").map(() => list[k++]!));
}

/** Linhas que sobem de trás de uma máscara (editorial), estalam (gráfico) ou ganham foco (cinema). */
const Lines: React.FC<{ ctx: Ctx; text: SpotText; start: number; end: number; ink: string; align: "left" | "center"; maxWidth: number; scaleIn?: boolean }> = ({ ctx, text, start, end, ink, align, maxWidth, scaleIn }) => {
  const f = useCurrentFrame();
  const spec = typeSpec(ctx, text.role);
  const list = tokens(spec.upper ? text.text.toUpperCase() : text.text);
  const lines = wrapTokens(list, spec.chars);
  const longest = Math.max(...lines.map((l) => l.map((t) => t.word).join(" ").length));
  const size = Math.min(spec.size, maxWidth / Math.max(1, longest * (spec.factor + spec.tracking)));
  const lang = ctx.p.language;
  const block = ctx.p.emphasis === "block";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start", textAlign: align }}>
      {lines.map((line, i) => {
        const a = start + i * (lang === "graphic" ? 3 : 5);
        const pin = progress(f, a, a + (lang === "cinematic" ? 26 : 16), ctx.m.out);
        const pout = progress(f, end - 10 + i * 2, end - 1 + i * 2, easeInOut);
        const pop = lang === "graphic" ? spring({ frame: f - a, fps: ctx.fps, config: { damping: 12, stiffness: 170, mass: 0.7 } }) : pin;
        // Gancho: a frase "chega" de perto, com desfoque de movimento (sem quadro vazio no início).
        const zoom = scaleIn ? spring({ frame: f - a, fps: ctx.fps, config: { damping: 16, stiffness: 120, mass: 0.8 } }) : 1;
        const style: React.CSSProperties = scaleIn
          ? { transform: `scale(${1 + (1 - zoom) * 1.6})`, filter: `blur(${(1 - zoom) * 14}px)`, opacity: Math.min(1, 0.35 + zoom) * (1 - pout), letterSpacing: `${spec.tracking}em` }
          : lang === "cinematic"
            ? { opacity: pin * (1 - pout), filter: `blur(${(1 - pin) * 10 + pout * 6}px)`, letterSpacing: `${spec.tracking + (1 - pin) * 0.25}em` }
            : { transform: `translateY(${(1 - pin) * 112 - pout * 112}%) scale(${lang === "graphic" ? 0.86 + 0.14 * pop : 1})`, letterSpacing: `${spec.tracking}em` };
        const emWipe = progress(f, a + 6, a + 18, ctx.m.out) * (1 - pout);
        return (
          <div key={i} style={{ overflow: scaleIn ? "visible" : "hidden", paddingBottom: size * 0.06 }}>
            <div style={{ fontFamily: spec.font, fontWeight: spec.weight, fontSize: size, lineHeight: spec.lineHeight, color: ink, whiteSpace: "nowrap", transformOrigin: align === "center" ? "50% 60%" : "0% 100%", display: "flex", gap: `0 ${size * 0.26}px`, justifyContent: align === "center" ? "center" : "flex-start", ...style }}>
              {line.map((t, j) => (t.em ? (
                block ? (
                  <span key={j} style={{ position: "relative", padding: `0 ${size * 0.12}px`, color: ctx.p.palette.dark }}>
                    <span style={{ position: "absolute", left: 0, top: size * 0.04, bottom: size * 0.02, width: `${emWipe * 100}%`, background: ctx.p.palette.accent }} />
                    <span style={{ position: "relative", color: emWipe > 0.5 ? ctx.p.palette.dark : ink }}>{t.word}</span>
                  </span>
                ) : <span key={j} style={{ color: ctx.p.palette.accent, fontStyle: spec.font === "DM Serif Display" ? "italic" : "normal" }}>{t.word}</span>
              ) : <span key={j}>{t.word}</span>))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Legenda em pílula: as palavras acendem na ordem da leitura (retenção). */
const CaptionPill: React.FC<{ ctx: Ctx; text: string; start: number; end: number; y?: number; spoken?: { start: number; end: number }[] }> = ({ ctx, text, start, end, y, spoken }) => {
  const f = useCurrentFrame();
  const words = text.replace(/\*/g, "").split(/\s+/).filter(Boolean);
  const pin = progress(f, start, start + 10, ctx.m.out) * (1 - progress(f, end - 8, end, easeInOut));
  const per = Math.max(3, Math.min(8, Math.floor((end - start - 16) / Math.max(1, words.length))));
  // Com narração, cada palavra acende quando é DITA (tempos do sintetizador), não num relógio fixo.
  const lit = (i: number) => (spoken && spoken.length === words.length ? f >= spoken[i]!.start : f >= start + 4 + i * per);
  const current = (i: number) => (spoken && spoken.length === words.length ? f >= spoken[i]!.start && f < spoken[i]!.end + 3 : i === Math.floor((f - start - 4) / per));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, ...(y !== undefined ? { top: y - 40 } : { bottom: ctx.H - ctx.box.bottom + 40 }), display: "flex", justifyContent: "center", opacity: pin, transform: `translateY(${(1 - pin) * 20}px)` }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", maxWidth: ctx.box.width, gap: "6px 16px", padding: "18px 34px", borderRadius: 22, background: "rgba(10,10,10,0.8)", backdropFilter: "blur(8px)", fontFamily: SANS, fontSize: 52, color: "#FFFFFF", boxShadow: "0 12px 30px rgba(0,0,0,0.35)" }}>
        {words.map((w, i) => <span key={i} style={{ opacity: lit(i) ? 1 : 0.38, color: lit(i) && current(i) ? ctx.p.palette.accent : "#FFFFFF" }}>{w}</span>)}
      </div>
    </div>
  );
};

/** Colchetes de foco nos cantos do que importa (a estampa), entrando de fora para dentro. */
const FocusBrackets: React.FC<{ rect: Frac; color: string; start: number; end: number }> = ({ rect, color, start, end }) => {
  const f = useCurrentFrame();
  const p = progress(f, start, start + 12, easeInOut) * (1 - progress(f, end - 8, end, easeInOut));
  if (p <= 0) return null;
  const pad = 26 + (1 - p) * 60;
  const L = 44;
  const r = { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad };
  const corner = (x: number, y: number, sx: number, sy: number) => <path d={`M ${x} ${y + sy * L} L ${x} ${y} L ${x + sx * L} ${y}`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="square" />;
  return (
    <svg style={{ position: "absolute", inset: 0, overflow: "visible", opacity: p }} width="100%" height="100%">
      {corner(r.x, r.y, 1, 1)}{corner(r.x + r.w, r.y, -1, 1)}{corner(r.x, r.y + r.h, 1, -1)}{corner(r.x + r.w, r.y + r.h, -1, -1)}
    </svg>
  );
};

/** Bloco de texto do plano: kicker com filete que se desenha + título; tinta escolhida pela luz da foto. */
const TextBlock: React.FC<{ ctx: Ctx; texts: SpotText[]; placement: "top" | "bottom" | "center"; ink: string; start: number; end: number; align?: "left" | "center"; spokenWords?: { start: number; end: number }[] }> = ({ ctx, texts, placement, ink, start, end, align, spokenWords }) => {
  const f = useCurrentFrame();
  const { box } = ctx;
  const al = align ?? ctx.p.align ?? (ctx.p.language === "editorial" ? "left" : "center");
  const kicker = texts.find((t) => t.role === "kicker");
  const rest = texts.filter((t) => t.role !== "kicker" && t.role !== "caption");
  const captions = texts.filter((t) => t.role === "caption");
  const rule = progress(f, start, start + 14, ctx.m.out) * (1 - progress(f, end - 10, end - 2, easeInOut));
  const pos: React.CSSProperties = placement === "top" ? { top: box.top + 10 } : placement === "bottom" ? { bottom: ctx.H - box.bottom + 10 } : { top: ctx.H * 0.5, transform: "translateY(-50%)" };
  return (
    <>
    {captions.map((c, i) => <CaptionPill key={`c${i}`} ctx={ctx} text={c.text} start={start + 10} end={end} spoken={spokenWords} />)}
    <div style={{ position: "absolute", left: box.left, width: box.width, display: "flex", flexDirection: "column", alignItems: al === "center" ? "center" : "flex-start", gap: 18, ...pos }}>
      {kicker ? (
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {ctx.p.language !== "cinematic" ? <div style={{ width: 64 * rule, height: 2, background: ctx.p.palette.accent }} /> : null}
          <Lines ctx={ctx} text={kicker} start={start} end={end} ink={ink} align={al} maxWidth={box.width} />
        </div>
      ) : null}
      {rest.map((t, i) => <Lines key={i} ctx={ctx} text={t} start={start + 6 + i * 8} end={end} ink={ink} align={al} maxWidth={box.width} />)}
    </div>
    </>
  );
};

// ---------------------------------------------------------------------------------------------
// Foto com câmera virtual
// ---------------------------------------------------------------------------------------------

const Plate: React.FC<{ photo: SpotPhoto; rect: Frac; W: number; style?: React.CSSProperties }> = ({ photo, rect, W, style }) => {
  const t = imageTransform(photo, rect, W);
  return <Img src={photo.src} style={{ position: "absolute", left: 0, top: 0, width: photo.w, height: photo.h, maxWidth: "none", transform: `translate(${t.left}px, ${t.top}px) scale(${t.scale})`, transformOrigin: "0 0", ...style }} />;
};

function cameraAt(ctx: Ctx, photo: SpotPhoto, shot: SpotShot, t: number, aspect = ctx.W / ctx.H, width = ctx.W): Frac {
  const cam = shot.camera ?? { from: "full", to: "full" };
  const a = framing(photo, cam.from, aspect, width);
  const b = framing(photo, cam.to, aspect, width);
  return lerpRect(a, b, ctx.m.inOut(clamp01(t)));
}

/** Mesma câmera em outra variante: a estampa fica no MESMO lugar da tela (match-cut entre cores). */
function alignRect(rect: Frac, ref: SpotPhoto, photo: SpotPhoto): Frac {
  if (!ref.print || !photo.print) return rect;
  const pr = { cx: (ref.print.x + ref.print.w / 2) * ref.w, cy: (ref.print.y + ref.print.h / 2) * ref.h, w: ref.print.w * ref.w };
  const pv = { cx: (photo.print.x + photo.print.w / 2) * photo.w, cy: (photo.print.y + photo.print.h / 2) * photo.h, w: photo.print.w * photo.w };
  const s = pv.w / pr.w;
  const x = ((rect.x * ref.w - pr.cx) * s + pv.cx) / photo.w;
  const y = ((rect.y * ref.h - pr.cy) * s + pv.cy) / photo.h;
  return clampRect({ x, y, w: (rect.w * ref.w * s) / photo.w, h: (rect.h * ref.h * s) / photo.h });
}

function inkFor(ctx: Ctx, photo: SpotPhoto | undefined, rect: Frac | undefined, placement: "top" | "bottom" | "center") {
  const { W, H, box, p } = ctx;
  const area = placement === "top" ? { x: box.left, y: box.top, w: box.width, h: H * 0.2 } : placement === "bottom" ? { x: box.left, y: box.bottom - H * 0.22, w: box.width, h: H * 0.22 } : { x: box.left, y: H * 0.4, w: box.width, h: H * 0.2 };
  const light = photo && rect ? lumaUnder(photo.luma, area, rect, W, H) : { mean: 30, spread: 0 };
  const dark = light.mean > 140;
  return { ink: dark ? p.palette.ink : p.palette.light, scrim: light.spread > 42 ? (dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)") : undefined, area };
}

const Scrim: React.FC<{ placement: "top" | "bottom" | "center"; color?: string; H: number; opacity: number }> = ({ placement, color, H, opacity }) => {
  if (!color) return null;
  const dir = placement === "top" ? "to bottom" : placement === "bottom" ? "to top" : "to bottom";
  const pos: React.CSSProperties = placement === "top" ? { top: 0, height: H * 0.42 } : placement === "bottom" ? { bottom: 0, height: H * 0.45 } : { top: H * 0.3, height: H * 0.4 };
  return <div style={{ position: "absolute", left: 0, right: 0, ...pos, opacity, background: placement === "center" ? `radial-gradient(ellipse at 50% 50%, ${color} 0%, transparent 70%)` : `linear-gradient(${dir}, ${color} 0%, transparent 100%)` }} />;
};

// ---------------------------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------------------------

type ShotRender = React.FC<{ ctx: Ctx; shot: SpotShot; D: number }>;

const Sheen: React.FC<{ start: number; dur: number; mask?: string; intensity?: number }> = ({ start, dur, mask, intensity = 0.55 }) => {
  const f = useCurrentFrame();
  const t = progress(f, start, start + dur, easeInOut);
  if (t <= 0 || t >= 1) return null;
  const maskStyle: React.CSSProperties = mask ? { WebkitMaskImage: `url(${mask})`, maskImage: `url(${mask})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" } : {};
  return <div style={{ position: "absolute", inset: 0, mixBlendMode: "screen", background: `linear-gradient(105deg, transparent ${t * 150 - 50}%, rgba(255,255,255,${intensity}) ${t * 150 - 30}%, transparent ${t * 150 - 10}%)`, ...maskStyle }} />;
};

/** A estampa se monta, elemento por elemento (recortes da FOTO, cores originais), e pousa no produto. */
const PrintAssemble: ShotRender = ({ ctx, shot, D }) => {
  const f = useCurrentFrame();
  const { W, H, p } = ctx;
  const cut = p.cutout;
  if (!cut) return null;
  const gw = W * 0.84;
  const gh = (gw * cut.h) / cut.w;
  const assembled = { x: (W - gw) / 2, y: H * 0.43 - gh / 2, w: gw, h: gh };
  const landStart = shot.frames - 8;
  const lp = shot.land ? ctx.m.inOut(progress(f, landStart, D, easeInOut)) : 0;
  const g = shot.land ? { x: interpolate(lp, [0, 1], [assembled.x, shot.land.x]), y: interpolate(lp, [0, 1], [assembled.y, shot.land.y]), w: interpolate(lp, [0, 1], [assembled.w, shot.land.w]), h: interpolate(lp, [0, 1], [assembled.h, shot.land.h]) } : assembled;
  const events = shot.events ?? cut.elements.map((_, i) => 4 + i * 6);
  const last = events[events.length - 1] ?? 0;
  const glow = progress(f, 0, last + 10, ctx.m.out);
  const texts = shot.texts ?? [];
  const field = shot.field ?? p.palette.dark;
  return (
    <AbsoluteFill style={{ background: field }}>
      <div style={{ position: "absolute", left: W * 0.5 - W * 0.6, top: H * 0.43 - W * 0.6, width: W * 1.2, height: W * 1.2, borderRadius: "50%", opacity: 0.22 * glow * (1 - lp), background: `radial-gradient(circle, ${p.palette.accent} 0%, transparent 62%)` }} />
      <div style={{ position: "absolute", left: g.x, top: g.y, width: g.w, height: g.h }}>
        {cut.elements.map((el, i) => {
          const s = spring({ frame: f - (events[i] ?? 0), fps: ctx.fps, config: { damping: 13, stiffness: 170, mass: 0.7 } });
          const pad = 0.012;
          const bx = Math.max(0, el.x - pad), by = Math.max(0, el.y - pad * 3);
          const bw = Math.min(1 - bx, el.w + 2 * pad), bh = Math.min(1 - by, el.h + pad * 6);
          return (
            <div key={i} style={{ position: "absolute", left: bx * g.w, top: by * g.h, width: bw * g.w, height: bh * g.h, overflow: "hidden", opacity: clamp01(s * 2), transform: `translateY(${(1 - s) * 70}px) scale(${0.55 + 0.45 * s}) rotate(${(1 - s) * (i % 2 ? -12 : 12)}deg)`, transformOrigin: "50% 80%" }}>
              <Img src={cut.src} style={{ position: "absolute", left: -bx * g.w, top: -by * g.h, width: g.w, height: g.h, maxWidth: "none" }} />
            </div>
          );
        })}
        <Sheen start={last + 8} dur={22} mask={cut.src} />
      </div>
      {texts.length ? <TextBlock ctx={ctx} texts={texts} placement={shot.placement ?? "bottom"} ink={luminance(field) > 0.4 ? p.palette.ink : p.palette.light} start={last + 4} end={landStart} align="center" /> : null}
    </AbsoluteFill>
  );
};

/** Foto em tela cheia com câmera com intenção (aproxima, revela, desce), texto legível pela luz. */
const Fullbleed: ShotRender = ({ ctx, shot, D }) => {
  const f = useCurrentFrame();
  const photo = ctx.p.photos[shot.photo ?? ""];
  if (!photo) return null;
  const rect = cameraAt(ctx, photo, shot, f / D);
  const placement = shot.placement ?? "top";
  const mid = cameraAt(ctx, photo, shot, 0.5);
  const { ink, scrim } = inkFor(ctx, photo, mid, placement);
  const texts = shot.texts ?? [];
  const tIn = (shot.transitionFrames ?? 0) + 4;
  return (
    <AbsoluteFill style={{ background: shot.field ?? ctx.p.palette.dark, overflow: "hidden" }}>
      <Plate photo={photo} rect={rect} W={ctx.W} />
      {shot.kind === "macro" ? <Sheen start={Math.round(D * 0.35)} dur={30} intensity={0.22} /> : null}
      {ctx.p.language === "cinematic" || shot.kind === "macro" ? <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 46%, transparent 52%, rgba(0,0,0,0.5) 100%)" }} /> : null}
      {shot.focus && photo.print ? <FocusBrackets rect={toScreen(photo.print, rect, ctx.W, ctx.H)} color={ctx.p.palette.accent} start={tIn + 6} end={shot.frames} /> : null}
      {texts.length ? <><Scrim placement={placement} color={scrim} H={ctx.H} opacity={progress(f, tIn - 4, tIn + 10) * (1 - progress(f, shot.frames - 8, shot.frames))} /><TextBlock ctx={ctx} texts={texts} placement={placement} ink={ink} start={tIn} end={shot.frames} spokenWords={shot.words} /></> : null}
    </AbsoluteFill>
  );
};

/** Faixas: as variantes empilhadas, a estampa no centro de cada faixa — a paleta da coleção num quadro. */
const Bands: ShotRender = ({ ctx, shot, D }) => {
  const f = useCurrentFrame();
  const { W, H, p } = ctx;
  const ids = (shot.photos ?? []).slice(0, 3);
  const gap = 10;
  const bandH = (H - gap * (ids.length - 1)) / ids.length;
  const events = shot.kind === "countdown" ? ids.map(() => 0) : shot.events ?? ids.map((_, i) => i * 8);
  const labels = (shot.texts ?? []).filter((t) => t.role === "label").map((t) => t.text);
  return (
    <AbsoluteFill style={{ background: shot.field ?? p.palette.dark }}>
      {ids.map((id, i) => {
        const photo = p.photos[id];
        if (!photo) return null;
        const rp = progress(f, events[i] ?? 0, (events[i] ?? 0) + 14, ctx.m.out);
        const base = bandFrame(photo, W / bandH, W);
        const zoom = 1 - (shot.kind === "countdown" ? 0.22 : 0.06) * progress(f, 0, D, shot.kind === "countdown" ? ctx.m.inOut : easeInOut);
        const rect = { x: base.x + (base.w * (1 - zoom)) / 2, y: base.y + (base.h * (1 - zoom)) / 2, w: base.w * zoom, h: base.h * zoom };
        const fromLeft = i % 2 === 0;
        const label = progress(f, (events[i] ?? 0) + 8, (events[i] ?? 0) + 20, ctx.m.out) * (1 - progress(f, shot.frames - 8, shot.frames, easeInOut));
        return (
          <div key={id} style={{ position: "absolute", left: 0, top: i * (bandH + gap), width: W, height: bandH, overflow: "hidden", clipPath: fromLeft ? `inset(0 ${(1 - rp) * 100}% 0 0)` : `inset(0 0 0 ${(1 - rp) * 100}%)` }}>
            <div style={{ position: "absolute", inset: 0, transform: `translateX(${(1 - rp) * (fromLeft ? -90 : 90)}px)` }}>
              <Plate photo={photo} rect={rect} W={W} />
            </div>
            {labels[i] ? (
              // Rótulo de opção (A/B): bloco de destaque com a letra, embaixo à esquerda (tecido livre, longe da estampa).
              <div style={{ position: "absolute", left: ctx.box.left, bottom: i === ids.length - 1 ? ctx.H * 0.06 : 30, display: "flex", alignItems: "center", gap: 16, opacity: label, transform: `translateX(${(1 - label) * -30}px)` }}>
                <div style={{ minWidth: 92, height: 92, display: "flex", alignItems: "center", justifyContent: "center", background: p.palette.accent, color: p.palette.dark, fontFamily: p.brand.display, fontSize: 72, lineHeight: 1 }}>{labels[i]}</div>
              </div>
            ) : photo.name ? (
              <div style={{ position: "absolute", left: ctx.box.left, bottom: 26, display: "flex", alignItems: "center", gap: 14, opacity: label, transform: `translateY(${(1 - label) * 14}px)` }}>
                <div style={{ width: 22, height: 22, background: photo.fabric ?? "#888", border: "2px solid rgba(255,255,255,0.85)" }} />
                <div style={{ fontFamily: SANS, fontSize: 30, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FFFFFF", textShadow: "0 1px 10px rgba(0,0,0,0.55)" }}>{photo.name}</div>
              </div>
            ) : null}
          </div>
        );
      })}
      {(shot.texts ?? []).filter((t) => t.role === "caption").map((c, i) => <CaptionPill key={i} ctx={ctx} text={c.text} start={(events[ids.length - 1] ?? 0) + 6} end={shot.frames} y={bandH + gap / 2} spoken={shot.words} />)}
    </AbsoluteFill>
  );
};

/** Troca de cor com a estampa travada no mesmo lugar; a faixa da próxima cor varre o quadro. */
const VariantCycle: ShotRender = ({ ctx, shot, D }) => {
  const f = useCurrentFrame();
  const { W, H, p } = ctx;
  const ids = shot.photos ?? [];
  const ref = p.photos[ids[0] ?? ""];
  if (!ref) return null;
  const switches = shot.events ?? ids.slice(1).map((_, i) => Math.round(((i + 1) * shot.frames) / ids.length));
  const rect = cameraAt(ctx, ref, shot, f / D);
  const wipe = 9;
  let idx = 0;
  for (let i = 0; i < switches.length; i += 1) if (f >= switches[i]!) idx = i + 1;
  const current = p.photos[ids[idx]!]!;
  const nextIdx = idx + 1 < ids.length && f >= (switches[idx] ?? Infinity) - wipe ? idx + 1 : -1;
  const wp = nextIdx > 0 ? progress(f, switches[idx]! - wipe, switches[idx]!, easeInOut) : 0;
  const next = nextIdx > 0 ? p.photos[ids[nextIdx]!] : undefined;
  const labelFor = (i: number) => `${String(i + 1).padStart(2, "0")} · ${p.photos[ids[i]!]?.name ?? ""}`;
  const roll = progress(f, (switches[idx - 1] ?? 0), (switches[idx - 1] ?? 0) + 10, ctx.m.out);
  const exit = 1 - progress(f, shot.frames - 8, shot.frames, easeInOut);
  return (
    <AbsoluteFill style={{ background: p.palette.dark, overflow: "hidden" }}>
      <Plate photo={current} rect={alignRect(rect, ref, current)} W={W} />
      {next ? (
        <>
          <div style={{ position: "absolute", inset: 0, clipPath: `inset(${(1 - wp) * 100}% 0 0 0)` }}><Plate photo={next} rect={alignRect(rect, ref, next)} W={W} /></div>
          <div style={{ position: "absolute", left: 0, right: 0, top: (1 - wp) * H - 26, height: 26, background: next.fabric ?? p.palette.accent, opacity: wp < 1 ? 1 : 0 }} />
        </>
      ) : null}
      <div style={{ position: "absolute", left: ctx.box.left, ...((shot.placement ?? "top") === "bottom" ? { top: ctx.box.top } : { bottom: H - ctx.box.bottom + 8 }), overflow: "hidden", height: 44, opacity: exit }}>
        <div style={{ transform: `translateY(${(1 - roll) * 100}%)`, fontFamily: SANS, fontSize: 32, letterSpacing: "0.24em", textTransform: "uppercase", color: "#FFFFFF", textShadow: "0 1px 12px rgba(0,0,0,0.5)" }}>{labelFor(idx)}</div>
      </div>
      {shot.texts?.length ? <TextBlock ctx={ctx} texts={shot.texts} placement={shot.placement ?? "top"} ink={inkFor(ctx, current, alignRect(rect, ref, current), shot.placement ?? "top").ink} start={(shot.transitionFrames ?? 0) + 4} end={shot.frames} /> : null}
    </AbsoluteFill>
  );
};

/** Cartela tipográfica: o texto é a imagem (campo de cor da marca). */
const TypeCard: ShotRender = ({ ctx, shot }) => {
  const field = shot.field ?? ctx.p.palette.dark;
  return (
    <AbsoluteFill style={{ background: field }}>
      <TextBlock ctx={ctx} texts={shot.texts ?? []} placement={shot.placement ?? "center"} ink={luminance(field) > 0.4 ? ctx.p.palette.ink : ctx.p.palette.light} start={(shot.transitionFrames ?? 0) + 2} end={shot.frames + 40} />
    </AbsoluteFill>
  );
};

/**
 * Cartão final: a logo OFICIAL nasce de uma linha de luz, o título fecha a ideia, o botão pede a ação e
 * as fotos do produto ficam em cartões no rodapé (o produto continua na tela até o último quadro).
 */
const LogoResolve: ShotRender = ({ ctx, shot }) => {
  const f = useCurrentFrame();
  const { W, H, p, box } = ctx;
  const requested = shot.field ?? p.palette.light;
  // Logo escura em fundo escuro (ou clara em fundo claro) some: troca o FUNDO, nunca a logo.
  const field = p.logoTone === "dark" && luminance(requested) < 0.35 ? p.palette.light : p.logoTone === "light" && luminance(requested) > 0.6 ? p.palette.dark : requested;
  const start = (shot.transitionFrames ?? 0) + 1;
  const line = progress(f, start, start + 10, ctx.m.out);
  const open = progress(f, start + 7, start + 22, ctx.m.out);
  const lineFade = 1 - progress(f, start + 18, start + 30, easeInOut);
  const lw = W * 0.56;
  const lh = lw / (p.logoAspect ?? 1);
  const logoY = box.top + 40;
  const headline = shot.texts?.find((t) => t.role === "headline");
  const cta = shot.texts?.find((t) => t.role === "cta");
  const strip = shot.strip ?? [];
  const ink = luminance(field) > 0.4 ? p.palette.ink : p.palette.light;
  const button = spring({ frame: f - (start + 30), fps: ctx.fps, config: { damping: 12, stiffness: 150, mass: 0.8 } });
  const headY = logoY + lh + 70;
  const hs = headline ? typeSpec(ctx, "headline") : undefined;
  const headLines = headline && hs ? wrapTokens(tokens(hs.upper ? headline.text.toUpperCase() : headline.text), hs.chars) : [];
  const headSize = hs && headLines.length ? Math.min(hs.size, box.width / Math.max(1, Math.max(...headLines.map((l) => l.map((t) => t.word).join(" ").length)) * (hs.factor + hs.tracking))) : 0;
  const buttonY = headY + headLines.length * headSize * (hs?.lineHeight ?? 1) * 1.12 + 60;
  const push = 1 + 0.035 * progress(f, start + 20, shot.frames + 30, easeInOut);
  return (
    <AbsoluteFill style={{ background: field }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: "50% 40%" }}>
      <div style={{ position: "absolute", left: (W - W * 0.84 * line) / 2, top: logoY + lh / 2 - 1, width: W * 0.84 * line, height: 3, background: p.palette.accent, opacity: lineFade, boxShadow: `0 0 24px 4px ${p.palette.accent}` }} />
      {p.logo ? <Img src={p.logo} style={{ position: "absolute", left: (W - lw) / 2, top: logoY, width: lw, height: lh, clipPath: `inset(${(1 - open) * 50}% 0 ${(1 - open) * 50}% 0)` }} /> : null}
      {headline ? (
        <div style={{ position: "absolute", left: box.left, width: box.width, top: headY }}>
          <Lines ctx={ctx} text={headline} start={start + 16} end={shot.frames + 60} ink={ink} align="center" maxWidth={box.width} />
        </div>
      ) : null}
      {cta ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: buttonY, display: "flex", justifyContent: "center", opacity: clamp01(button * 1.5), transform: `scale(${0.7 + 0.3 * button})` }}>
          <div style={{ position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: 18, padding: "26px 46px", borderRadius: 14, background: p.palette.accent, color: p.palette.dark, fontFamily: SANS, fontSize: 36, letterSpacing: "0.16em", textTransform: "uppercase", boxShadow: "0 18px 40px rgba(0,0,0,0.22)" }}>
            {cta.text}{/\b(site|link|loja|compr|acess|saiba)/i.test(cta.text) ? <span style={{ fontSize: 34 }}>↗</span> : null}
            <Sheen start={start + 52} dur={24} intensity={0.6} />
          </div>
        </div>
      ) : null}
      {strip.map((id, i) => {
        const photo = p.photos[id];
        if (!photo) return null;
        const s = spring({ frame: f - (start + 20 + i * 4), fps: ctx.fps, config: { damping: 14, stiffness: 120, mass: 0.9 } });
        const cw = 250, ch = cw * 1.28;
        const rect = framing(photo, "chest", cw / ch, cw, 3);
        const x = W / 2 + (i - (strip.length - 1) / 2) * (cw + 30) - cw / 2;
        return (
          <div key={id} style={{ position: "absolute", left: x, top: box.bottom - ch - 10 + (1 - s) * 260, width: cw, height: ch, overflow: "hidden", borderRadius: 10, border: "6px solid #FFFFFF", boxShadow: "0 22px 40px rgba(0,0,0,0.28)", transform: `rotate(${(i - 1) * 4 * s}deg)`, opacity: clamp01(s * 1.4) }}>
            <Plate photo={photo} rect={rect} W={cw} />
          </div>
        );
      })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Gancho: frase curta e GIGANTE já no primeiro quadro, chegando de perto sobre o detalhe do produto. */
const HookType: ShotRender = ({ ctx, shot, D }) => {
  const f = useCurrentFrame();
  const photo = ctx.p.photos[shot.photo ?? ""];
  const rect = photo ? cameraAt(ctx, photo, shot, f / D) : undefined;
  const headline = shot.texts?.find((t) => t.role === "headline");
  // O texto do gancho nunca cruza o traço: vai para baixo da estampa (no fim da câmera) ou para o topo.
  const end = photo ? cameraAt(ctx, photo, shot, 1) : undefined;
  const pr = photo?.print && end ? toScreen(photo.print, end, ctx.W, ctx.H) : undefined;
  const below = pr ? Math.min(ctx.H, pr.y + pr.h) + 40 : ctx.H * 0.6;
  const top = below + 300 < ctx.box.bottom ? below : ctx.box.top + 10;
  return (
    <AbsoluteFill style={{ background: shot.field ?? ctx.p.palette.dark, overflow: "hidden" }}>
      {photo && rect ? <div style={{ position: "absolute", inset: 0, transform: `scale(${1 + 0.14 * (1 - progress(f, 0, 9, ctx.m.out))})` }}><Plate photo={photo} rect={rect} W={ctx.W} /></div> : null}
      {headline && pr && top < pr.y + pr.h ? <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: top + 360, background: "linear-gradient(to bottom, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.45) 70%, transparent 100%)" }} /> : null}
      {headline ? (
        <div style={{ position: "absolute", left: ctx.box.left, width: ctx.box.width, top }}>
          <Lines ctx={{ ...ctx, p: { ...ctx.p, language: "graphic" } }} text={{ ...headline, text: headline.text }} start={0} end={shot.frames} ink={ctx.p.palette.light} align="center" maxWidth={ctx.box.width} scaleIn />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** O traço se DESENHA: a estampa real (recorte da foto) é revelada ao longo da linha, com ponta de luz. */
const TraceDraw: ShotRender = ({ ctx, shot, D }) => {
  const f = useCurrentFrame();
  const { W, H, p } = ctx;
  const cut = p.cutout;
  if (!cut) return null;
  const gh = Math.min(H * 0.42, (W * 0.86 * cut.h) / cut.w);
  const gw = (gh * cut.w) / cut.h;
  const assembled = { x: (W - gw) / 2, y: H * 0.42 - gh / 2, w: gw, h: gh };
  const s0 = shot.events?.[0] ?? 4;
  const s1 = shot.events?.[1] ?? Math.round(shot.frames * 0.78);
  const dp = progress(f, s0, s1, ctx.m.out);
  const landStart = shot.frames - 8;
  const lp = shot.land ? ctx.m.inOut(progress(f, landStart, D, easeInOut)) : 0;
  const g = shot.land ? { x: interpolate(lp, [0, 1], [assembled.x, shot.land.x]), y: interpolate(lp, [0, 1], [assembled.y, shot.land.y]), w: interpolate(lp, [0, 1], [assembled.w, shot.land.w]), h: interpolate(lp, [0, 1], [assembled.h, shot.land.h]) } : assembled;
  const trace = cut.trace ?? [];
  const ty = trace.length ? trace[Math.min(trace.length - 1, Math.floor(dp * trace.length))]! : 0.5;
  const edge = dp * 100;
  const mask = `linear-gradient(to right, #000 ${edge - 1.5}%, transparent ${edge + 1.5}%)`;
  const field = shot.field ?? p.palette.dark;
  const texts = shot.texts ?? [];
  const photo = shot.photo ? p.photos[shot.photo] : undefined;
  if (photo?.print) {
    const rect = cameraAt(ctx, photo, shot, f / D);
    const pr = toScreen(photo.print, rect, W, H);
    const fade = progress(f, s1 + 4, s1 + 22, easeInOut);
    const goldMask: React.CSSProperties = { WebkitMaskImage: `url(${cut.src})`, maskImage: `url(${cut.src})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" };
    return (
      <AbsoluteFill style={{ background: field, overflow: "hidden" }}>
        <Plate photo={photo} rect={rect} W={W} />
        <div style={{ position: "absolute", left: pr.x, top: pr.y, width: pr.w, height: pr.h, opacity: 1 - fade, WebkitMaskImage: dp >= 1 ? undefined : mask, maskImage: dp >= 1 ? undefined : mask }}>
          <div style={{ position: "absolute", inset: 0, background: p.palette.accent, filter: "drop-shadow(0 0 10px rgba(255,210,90,0.9))", ...goldMask }} />
        </div>
        {dp > 0 && dp < 1 ? <div style={{ position: "absolute", left: pr.x + dp * pr.w - 12, top: pr.y + ty * pr.h - 12, width: 24, height: 24, borderRadius: "50%", background: "#FFFFFF", boxShadow: `0 0 26px 10px ${p.palette.accent}` }} /> : null}
        {texts.length ? <TextBlock ctx={ctx} texts={texts} placement={shot.placement ?? "top"} ink={inkFor(ctx, photo, rect, shot.placement ?? "top").ink} start={(shot.transitionFrames ?? 0) + 4} end={shot.frames} spokenWords={shot.words} /> : null}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: field }}>
      <div style={{ position: "absolute", left: W * 0.5 - W * 0.65, top: assembled.y + gh / 2 - W * 0.65, width: W * 1.3, height: W * 1.3, borderRadius: "50%", opacity: 0.2 * (1 - lp), background: `radial-gradient(circle, ${p.palette.accent} 0%, transparent 60%)` }} />
      <div style={{ position: "absolute", left: g.x, top: g.y, width: g.w, height: g.h, WebkitMaskImage: dp >= 1 ? undefined : mask, maskImage: dp >= 1 ? undefined : mask }}>
        <Img src={cut.src} style={{ width: "100%", height: "100%" }} />
      </div>
      {dp > 0 && dp < 1 ? <div style={{ position: "absolute", left: g.x + dp * g.w - 14, top: g.y + ty * g.h - 14, width: 28, height: 28, borderRadius: "50%", background: "#FFFFFF", boxShadow: `0 0 26px 10px ${p.palette.accent}` }} /> : null}
      <div style={{ position: "absolute", left: g.x, top: g.y, width: g.w, height: g.h }}><Sheen start={s1 + 2} dur={20} mask={cut.src} /></div>
      {texts.length ? <TextBlock ctx={ctx} texts={texts} placement={shot.placement ?? "bottom"} ink={luminance(field) > 0.4 ? p.palette.ink : p.palette.light} start={4} end={landStart} /> : null}
    </AbsoluteFill>
  );
};

/** Contagem regressiva sobre a comparação (o produto continua na tela): um número por batida. */
const Countdown: ShotRender = (props) => {
  const f = useCurrentFrame();
  const { ctx, shot } = props;
  const marks = shot.events ?? [0, 15, 30];
  let idx = 0;
  for (let i = 0; i < marks.length; i += 1) if (f >= marks[i]!) idx = i;
  const local = f - (marks[idx] ?? 0);
  const pop = spring({ frame: local, fps: ctx.fps, config: { damping: 11, stiffness: 190, mass: 0.6 } });
  const ring = progress(local, 0, (marks[1] ?? 15) - (marks[0] ?? 0), easeInOut);
  const n = marks.length - idx;
  return (
    <AbsoluteFill>
      <Bands {...props} />
      <div style={{ position: "absolute", left: ctx.W / 2 - 130, top: ctx.H / 2 - 130, width: 260, height: 260, borderRadius: "50%", background: ctx.p.palette.dark, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${0.6 + 0.4 * pop})`, boxShadow: "0 20px 60px rgba(0,0,0,0.45)" }}>
        <svg style={{ position: "absolute", inset: 0 }} width={260} height={260}><circle cx={130} cy={130} r={118} fill="none" stroke={ctx.p.palette.accent} strokeWidth={6} strokeDasharray={2 * Math.PI * 118} strokeDashoffset={ring * 2 * Math.PI * 118} transform="rotate(-90 130 130)" /></svg>
        <div style={{ fontFamily: ctx.p.brand.display, fontSize: 170, lineHeight: 1, color: ctx.p.palette.light }}>{n}</div>
      </div>
    </AbsoluteFill>
  );
};

const RENDER: Record<SpotShotKind, ShotRender> = { hook_type: HookType, trace_draw: TraceDraw, countdown: Countdown, print_assemble: PrintAssemble, fullbleed: Fullbleed, macro: Fullbleed, bands: Bands, variant_cycle: VariantCycle, type_card: TypeCard, logo_resolve: LogoResolve };

// ---------------------------------------------------------------------------------------------
// Transições coordenadas (a ENTRADA de um plano por cima da saída do anterior)
// ---------------------------------------------------------------------------------------------

function printCenter(ctx: Ctx, shot: SpotShot): { x: number; y: number } {
  const photo = ctx.p.photos[shot.photo ?? shot.photos?.[0] ?? ""];
  if (!photo?.print) return { x: ctx.W / 2, y: ctx.H / 2 };
  const s = toScreen(photo.print, cameraAt(ctx, photo, shot, 0), ctx.W, ctx.H);
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

const ShotLayer: React.FC<{ ctx: Ctx; shot: SpotShot; D: number; children: React.ReactNode }> = ({ ctx, shot, D, children }) => {
  const f = useCurrentFrame();
  const T = shot.transitionFrames ?? 0;
  const tr = shot.transition ?? "cut";
  const t = T > 0 ? progress(f, 0, T, easeInOut) : 1;
  let style: React.CSSProperties = {};
  let band: React.ReactNode = null;
  if (t < 1) {
    if (tr === "color_wipe") {
      const lead = clamp01((f / T) * 1.35);
      const trail = clamp01((f / T - 0.3) / 0.7);
      style = { clipPath: `inset(${(1 - ctx.m.inOut(trail)) * 100}% 0 0 0)` };
      band = <div style={{ position: "absolute", left: 0, right: 0, top: (1 - ctx.m.inOut(lead)) * ctx.H, bottom: ctx.m.inOut(trail) * ctx.H, background: shot.transitionColor ?? ctx.p.palette.accent }} />;
    } else if (tr === "mask_reveal") {
      style = { clipPath: `inset(${(1 - t) * 46}% ${(1 - t) * 40}% ${(1 - t) * 46}% ${(1 - t) * 40}%)` };
    } else if (tr === "iris_print") {
      const c = printCenter(ctx, shot);
      style = { clipPath: `circle(${t * Math.hypot(ctx.W, ctx.H)}px at ${c.x}px ${c.y}px)` };
    } else if (tr === "slide_up") {
      style = { transform: `translateY(${(1 - t) * 100}%)`, boxShadow: "0 -40px 80px rgba(0,0,0,0.35)" };
    } else if (tr === "dissolve" || tr === "match_print") {
      style = { opacity: t };
    }
  }
  return (
    <>
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
      {band}
    </>
  );
};

// ---------------------------------------------------------------------------------------------
// Camadas persistentes (identidade)
// ---------------------------------------------------------------------------------------------

const Grain: React.FC<{ amount: number }> = ({ amount }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (amount <= 0) return null;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, opacity: amount, mixBlendMode: "overlay", transform: "scale(2)", transformOrigin: "0 0", pointerEvents: "none" }} width={Math.ceil(width / 2)} height={Math.ceil(height / 2)}>
      <filter id="spot-grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={Math.floor(f / 2) % 9} /></filter>
      <rect width="100%" height="100%" filter="url(#spot-grain)" />
    </svg>
  );
};

const Identity: React.FC<{ ctx: Ctx; total: number }> = ({ ctx, total }) => {
  const f = useCurrentFrame();
  const { p, box, W } = ctx;
  if (p.language !== "editorial") return null;
  const chapters = p.shots.filter((s) => s.kind !== "logo_resolve");
  const idx = chapters.findIndex((s) => f >= s.from && f < s.from + s.frames);
  const logoFrom = p.shots.find((s) => s.kind === "logo_resolve")?.from ?? total;
  const vis = progress(f, 4, 18, ctx.m.out) * (1 - progress(f, logoFrom - 6, logoFrom + 4, easeInOut));
  if (vis <= 0 || idx < 0) return null;
  const shot = chapters[idx]!;
  const photo = p.photos[shot.photo ?? shot.photos?.[0] ?? ""];
  const rect = photo ? cameraAt(ctx, photo, shot, clamp01((f - shot.from) / shot.frames)) : undefined;
  const top = photo && rect ? lumaUnder(photo.luma, { x: 0, y: box.top - 70, w: W, h: 60 }, rect, W, ctx.H).mean : 30;
  const ink = shot.kind === "print_assemble" || shot.kind === "type_card" ? (luminance(shot.field ?? p.palette.dark) > 0.4 ? p.palette.ink : p.palette.light) : top > 140 ? p.palette.ink : p.palette.light;
  const style: React.CSSProperties = { fontFamily: SANS, fontSize: 24, letterSpacing: "0.34em", textTransform: "uppercase", color: ink, opacity: 0.85 * vis };
  return (
    <div style={{ position: "absolute", left: box.left, right: W - box.right, top: box.top - 64, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={style}>{`${String(idx + 1).padStart(2, "0")} / ${String(chapters.length).padStart(2, "0")}`}</div>
      <div style={{ flex: 1, height: 1, margin: "0 24px", background: ink, opacity: 0.35 * vis }} />
      <div style={style}>{p.brandLabel ?? p.brand.name}</div>
    </div>
  );
};

export const Spot: React.FC<SpotProps> = (props) => {
  const { width: W, height: H, fps, durationInFrames } = useVideoConfig();
  const ctx: Ctx = { p: props, W, H, fps, box: safeBox(props.safe, W, H), m: resolveMotion(props.motion) };
  const shots = props.shots;
  return (
    <AbsoluteFill style={{ background: props.palette.dark }}>
      {shots.map((original, i) => {
        let shot = original;
        const tail = shots[i + 1]?.transitionFrames ?? 0;
        const D = Math.min(durationInFrames - shot.from, shot.frames + tail);
        const Render = RENDER[shot.kind];
        // A estampa montada/desenhada POUSA onde ela aparece no plano seguinte (o corte vira continuidade).
        const next = shots[i + 1];
        const nextPhoto = next ? props.photos[next.photo ?? next.photos?.[0] ?? ""] : undefined;
        if ((shot.kind === "print_assemble" || shot.kind === "trace_draw") && !shot.land && next && nextPhoto?.print && (next.transition === "match_print" || next.transition === "dissolve")) {
          if (next.kind === "bands" || next.kind === "countdown") {
            const n = Math.min(3, next.photos?.length ?? 1);
            const bandH = (H - 10 * (n - 1)) / n;
            shot = { ...shot, land: toScreen(nextPhoto.print, bandFrame(nextPhoto, W / bandH, W), W, bandH) };
          } else shot = { ...shot, land: toScreen(nextPhoto.print, cameraAt(ctx, nextPhoto, next, 0), W, H) };
        }
        return (
          <Sequence key={i} from={shot.from} durationInFrames={Math.max(1, D)} layout="none">
            <ShotLayer ctx={ctx} shot={shot} D={D}><Render ctx={ctx} shot={shot} D={D} /></ShotLayer>
          </Sequence>
        );
      })}
      <Identity ctx={ctx} total={durationInFrames} />
      <Grain amount={props.language === "cinematic" ? 0.16 : 0.08} />
    </AbsoluteFill>
  );
};
