/**
 * Títulos e legendas do plano → arquivo ASS (libass, filtro `ass` do FFmpeg).
 *
 * Por que ASS: tipografia com a fonte real (TTF da marca), caixa de fundo, contorno, sombra, fade,
 * deslocamento, "pop" e destaque da palavra falada — o padrão de legendas de redes sociais — num
 * único filtro rápido, sem rasterizar texto à mão.
 *
 * Garantias:
 * - Quebra de linha feita AQUI pela largura real dos glifos (`font-metrics.ts`), no máximo 3 linhas,
 *   dentro da margem segura; se não couber, a fonte diminui. O libass não quebra sozinho (WrapStyle 2).
 * - Posições respeitam as áreas que a interface do Reels/TikTok cobre no 9:16.
 * - Legenda que coincide com um título na mesma posição muda de posição — texto nunca empilha.
 * - Texto do usuário é escapado: chaves e barras invertidas não viram comandos ASS.
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EditCaptionWord, EditTextAnimation, EditTextPosition, EditTextRole, EditTextStyle, VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import { loadFontMetrics, type FontMetrics } from "./font-metrics.js";
import { textArea, type Rect } from "./scene-compositions.js";

// ---------------------------------------------------------------------------
// Fontes
// ---------------------------------------------------------------------------

export type RegisteredFont = { family: string; file: string; bold: boolean; metrics: FontMetrics };

const FONT_DIR_CANDIDATES = [
  join(dirname(fileURLToPath(import.meta.url)), "..", "rendering", "assets"),
  join(process.cwd(), "src", "infrastructure", "rendering", "assets"),
];

let registry: RegisteredFont[] | null = null;

/** Fontes TTF empacotadas com a Vorix (OFL). Nomes de família lidos do próprio arquivo. */
export function fontRegistry(): RegisteredFont[] {
  if (registry) return registry;
  const dir = FONT_DIR_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!dir) throw new Error("Pasta de fontes do renderizador não encontrada (rode o build).");
  registry = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".ttf"))
    .map((name) => {
      const file = join(dir, name);
      const metrics = loadFontMetrics(file);
      return { family: metrics.family, file, bold: /bold/i.test(metrics.subfamily) || /bold/i.test(name), metrics };
    });
  return registry;
}

export const DEFAULT_SANS = "Barlow Condensed";

export function resolveFont(family: string | undefined, warnings: string[]): RegisteredFont {
  const fonts = fontRegistry();
  const wanted = (family ?? DEFAULT_SANS).toLowerCase();
  const found = fonts.find((font) => font.family.toLowerCase() === wanted);
  if (found) return found;
  const fallback = fonts.find((font) => font.family === DEFAULT_SANS) ?? fonts[0]!;
  if (family) warnings.push(`fonte "${family}" não disponível no servidor; usada ${fallback.family}`);
  return fallback;
}

// ---------------------------------------------------------------------------
// Janelas de texto
// ---------------------------------------------------------------------------

export type TextWindow = {
  text: string;
  role: EditTextRole | "caption_track";
  style: EditTextStyle;
  position: EditTextPosition;
  animation: EditTextAnimation;
  startSeconds: number;
  endSeconds: number;
  isCaption: boolean;
  words?: EditCaptionWord[];
  /** Área livre da composição (painel do split): o texto vai para lá, com a cor de texto da marca. */
  area?: Rect;
};

/** Centro vertical do bloco de texto (fração da altura, origem no topo). */
export const POSITION_Y: Record<"vertical" | "other", Record<EditTextPosition, number>> = {
  vertical: { top: 0.2, center: 0.47, lower_third: 0.64, bottom: 0.72 },
  other: { top: 0.14, center: 0.5, lower_third: 0.72, bottom: 0.85 },
};

function normalizeWords(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter((word) => word.length > 2);
}

/** Fração das palavras da legenda que aparecem no título (ignora palavras curtas e acentos). */
export function textSimilarity(title: string, caption: string): number {
  const captionWords = normalizeWords(caption);
  if (captionWords.length === 0) return 0;
  const titleWords = new Set(normalizeWords(title));
  return captionWords.filter((word) => titleWords.has(word)).length / captionWords.length;
}

function overlaps(a: TextWindow, b: TextWindow): boolean {
  return a.startSeconds < b.endSeconds && b.startSeconds < a.endSeconds;
}

export function collectTextWindows(plan: VideoEditPlan, warnings: string[]): TextWindow[] {
  const windows: TextWindow[] = [];
  for (const clip of plan.clips) {
    for (const overlay of clip.overlays) {
      const start = clip.recordStartSeconds + overlay.startOffsetSeconds;
      const area = textArea(clip.layout, plan.aspect, plan.width, plan.height);
      windows.push({ text: overlay.text, role: overlay.role, style: overlay.style, position: overlay.position, animation: overlay.animation, startSeconds: start, endSeconds: Math.min(plan.durationSeconds, start + overlay.durationSeconds), isCaption: false, ...(area ? { area } : {}) });
    }
  }
  const titles = [...windows];
  if (plan.captions?.enabled) {
    for (const segment of plan.captions.segments) {
      const fromWords = segment.words && segment.words.length > 0 ? segment.words.map((word) => word.text.trim()).filter(Boolean).join(" ") : "";
      let window: TextWindow = { text: fromWords || segment.text, role: "caption_track", style: plan.captions.style, position: plan.captions.position, animation: "fade", startSeconds: segment.startSeconds, endSeconds: Math.min(plan.durationSeconds, segment.endSeconds), isCaption: true, words: segment.words };
      // Legenda que repete um título simultâneo (ex.: narração lendo o CTA) é redundante: some.
      if (titles.some((title) => overlaps(title, window) && textSimilarity(title.text, window.text) >= (title.role === "cta" ? 0.6 : 0.85))) {
        warnings.push(`legenda "${window.text.slice(0, 24)}…" omitida: repete o texto na tela`);
        continue;
      }
      const clash = titles.find((title) => title.position === window.position && overlaps(title, window));
      if (clash) {
        const alternative: EditTextPosition = clash.position === "top" ? "lower_third" : "top";
        if (titles.some((title) => title.position === alternative && overlaps(title, window))) warnings.push(`legenda "${window.text.slice(0, 24)}…" coincide com dois títulos; mantida em ${window.position}`);
        else window = { ...window, position: alternative };
      }
      windows.push(window);
    }
  }
  return windows.filter((window) => window.endSeconds - window.startSeconds > 0.05);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export type LaidOutText = { lines: string[]; sizePx: number; widthPx: number; heightPx: number; shrunk: boolean };

const MAX_LINES = 3;
const MIN_SIZE_FRACTION = 0.022;

/** Quebra em até 3 linhas pela largura real; reduz a fonte até caber. */
export function layoutText(text: string, sizeFraction: number, font: FontMetrics, frameWidth: number, frameHeight: number, maxWidthFraction = 0.84): LaidOutText {
  const maxWidth = frameWidth * maxWidthFraction;
  let size = sizeFraction;
  const words = text.trim().split(/\s+/);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sizePx = Math.round(size * frameHeight);
    const lines: string[] = [];
    let current = "";
    let overflow = false;
    for (const word of words) {
      if (font.measure(word, sizePx) > maxWidth) overflow = true;
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.measure(candidate, sizePx) > maxWidth) {
        lines.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) lines.push(current);
    if (!overflow && lines.length <= MAX_LINES) {
      const widthPx = Math.max(...lines.map((line) => font.measure(line, sizePx)));
      return { lines, sizePx, widthPx, heightPx: lines.length * sizePx * 1.15, shrunk: size < sizeFraction - 1e-9 };
    }
    if (size <= MIN_SIZE_FRACTION) break;
    size = Math.max(MIN_SIZE_FRACTION, size * 0.9);
  }
  throw new Error(`Texto não cabe no quadro nem na fonte mínima: "${text.slice(0, 40)}"`);
}

// ---------------------------------------------------------------------------
// ASS
// ---------------------------------------------------------------------------

/** #RRGGBB → &HAABBGGRR do ASS (alfa 00 = opaco). */
export function assColor(hex: string, alpha = 0): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b}${g}${r}`.toUpperCase();
}

/** Texto do usuário não pode abrir bloco de comando `{...}` nem usar `\N`/`\h` por conta própria. */
export function escapeAssText(text: string): string {
  return text.replace(/\\/g, "∖").replace(/\{/g, "(").replace(/\}/g, ")").replace(/[\r\n]+/g, " ");
}

function assTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export type BuiltAss = { content: string; fontFiles: string[]; layouts: { text: string; lines: number; sizePx: number; widthPx: number; withinFrame: boolean }[]; warnings: string[] };

export type AssOptions = {
  /** Cor de destaque da palavra falada (padrão: amarelo de legenda de rede social). */
  highlightHex?: string;
};

export function buildAss(plan: VideoEditPlan, options: AssOptions = {}): BuiltAss {
  const warnings: string[] = [];
  const { width: W, height: H } = plan;
  const orientation = plan.aspect === "9:16" ? "vertical" : "other";
  const windows = collectTextWindows(plan, warnings);
  const fontFiles = new Set<string>();
  const layouts: BuiltAss["layouts"] = [];
  const events: string[] = [];

  for (const window of windows) {
    const font = resolveFont(window.style.fontFamily, warnings);
    fontFiles.add(font.file);
    // No painel do split o texto é limpo (sem caixa), na cor de texto da marca, dentro da largura do painel.
    const boxed = Boolean(window.style.backgroundHex) && !window.area;
    // O painel é superfície de design: o texto pode ser maior que sobre a foto.
    const layout = layoutText(window.text, window.area ? Math.min(0.12, window.style.size * 1.45) : window.style.size, font.metrics, W, H, window.area ? (window.area.w * 0.84) / W : boxed ? 0.8 : 0.86);
    if (layout.shrunk) warnings.push(`texto "${window.text.slice(0, 24)}…" reduzido para caber em ${MAX_LINES} linhas`);
    const padding = Math.round(layout.sizePx * 0.32);
    const withinFrame = layout.widthPx + 2 * padding <= W * 0.96;
    layouts.push({ text: window.text, lines: layout.lines.length, sizePx: layout.sizePx, widthPx: Math.round(layout.widthPx), withinFrame });

    const PANEL_Y: Record<string, number> = { top: 0.3, center: 0.5, lower_third: 0.64, bottom: 0.76 };
    const x = window.area ? Math.round(window.area.x + window.area.w / 2) : Math.round(W / 2);
    const y = window.area ? Math.round(window.area.y + window.area.h * PANEL_Y[window.position]!) : Math.round(POSITION_Y[orientation][window.position] * H);
    const textColor = (window.area && plan.look ? plan.look.panelTextHex : window.style.colorHex).toUpperCase();
    const box = window.style.backgroundHex?.toUpperCase();
    // Sem caixa: contorno escuro ou claro conforme o texto, mais sombra suave, para ler sobre foto.
    const outlineHex = box ?? (luminance(textColor) > 0.4 ? "#000000" : "#FFFFFF");
    const base = [
      `\\an5\\pos(${x},${y})`,
      `\\fn${font.family}\\fs${layout.sizePx}\\b${window.style.bold === false ? 0 : 1}`,
      `\\1c${assColor(textColor)}`,
      window.area ? `\\bord0\\shad0` : boxed ? `\\3c${assColor(box!)}\\3a&H26&\\bord${padding}\\shad0` : `\\3c${assColor(outlineHex)}\\bord${Math.max(2, Math.round(layout.sizePx * 0.06))}\\4c&H000000&\\4a&H80&\\shad${Math.max(1, Math.round(layout.sizePx * 0.05))}`,
    ];
    const durationMs = Math.round((window.endSeconds - window.startSeconds) * 1000);
    const fadeIn = window.isCaption ? 60 : Math.min(220, Math.floor(durationMs / 4));
    const fadeOut = window.isCaption ? 60 : Math.min(180, Math.floor(durationMs / 4));
    const anim: string[] = window.animation === "none" ? [] : [`\\fad(${fadeIn},${fadeOut})`];
    if (window.animation === "slide_up") anim.push(`\\move(${x},${y + Math.round(H * 0.035)},${x},${y},0,320)`);
    if (window.animation === "pop") anim.push(`\\fscx72\\fscy72\\t(0,150,\\fscx106\\fscy106)\\t(150,240,\\fscx100\\fscy100)`);
    if (window.animation === "kinetic") anim.splice(0, anim.length, `\\fad(0,${fadeOut})`);
    const style = boxed ? "Box" : "Plain";
    // Cinético: cada palavra entra em sequência (alfa + escala), ~110 ms por palavra.
    let wordIndex = 0;
    const text = window.animation === "kinetic"
      ? layout.lines.map((line) => line.split(" ").map((word) => { const t0 = wordIndex++ * 110; return `{\\alpha&HFF&\\fscx70\\fscy70\\t(${t0},${t0 + 200},\\alpha&H00&\\fscx100\\fscy100)}${escapeAssText(word)}`; }).join(" ")).join("\\N")
      : layout.lines.map(escapeAssText).join("\\N");

    if (window.isCaption && window.words && window.words.length > 0) {
      // Um evento por palavra: a frase inteira na tela, com a palavra falada destacada.
      const highlight = assColor((options.highlightHex ?? "#FFD43B").toUpperCase());
      const flat = layout.lines.map((line) => line.split(" "));
      const tokens = flat.flat();
      const timed = window.words.slice(0, tokens.length);
      timed.forEach((word, index) => {
        const start = Math.max(window.startSeconds, word.startSeconds);
        const end = index + 1 < timed.length ? Math.max(start + 0.04, timed[index + 1]!.startSeconds) : window.endSeconds;
        let counter = 0;
        const rendered = flat
          .map((line) => line.map((token) => (counter++ === index ? `{\\1c${highlight}}${escapeAssText(token)}{\\1c${assColor(textColor)}}` : escapeAssText(token))).join(" "))
          .join("\\N");
        events.push(`Dialogue: 1,${assTime(start)},${assTime(Math.min(end, window.endSeconds))},${style},,0,0,0,,{${base.join("")}}${rendered}`);
      });
      if (timed.length > 0 && timed[0]!.startSeconds > window.startSeconds + 0.05) {
        events.push(`Dialogue: 1,${assTime(window.startSeconds)},${assTime(timed[0]!.startSeconds)},${style},,0,0,0,,{${base.join("")}}${text}`);
      }
      continue;
    }
    events.push(`Dialogue: ${window.isCaption ? 1 : 2},${assTime(window.startSeconds)},${assTime(window.endSeconds)},${style},,0,0,0,,{${[...base, ...anim].join("")}}${text}`);
  }

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Plain,${DEFAULT_SANS},48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,5,0,0,0,1`,
    `Style: Box,${DEFAULT_SANS},48,&H00FFFFFF,&H00FFFFFF,&H26000000,&H00000000,-1,0,0,0,100,100,0,0,3,12,0,5,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  return { content: `${[...header, ...events].join("\n")}\n`, fontFiles: [...fontFiles], layouts, warnings };
}

export function fontFileName(file: string): string {
  return basename(file);
}
