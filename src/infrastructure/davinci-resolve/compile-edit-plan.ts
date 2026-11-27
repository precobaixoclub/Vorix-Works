/**
 * Compilador: plano de edição validado → sequência de operações da ponte DaVinci.
 *
 * Toda decisão numérica (quadros, enquadramento, keyframes de movimento/transição, quebra de linha,
 * posição de texto, colisão de legendas, tamanho do logo) acontece AQUI, em TypeScript puro e
 * testável. A ponte Lua só aplica os números. Isso mantém a superfície que roda dentro do DaVinci
 * mínima e sem decisões.
 *
 * Layout de trilhas (escolhido porque a API do Resolve não oferece "inserir transição"):
 * - V1/V2: clipes de conteúdo alternados; a sobreposição entre V1 e V2 é onde acontecem dissolve,
 *   push e zoom (animados por Fusion no clipe de cima).
 * - V3: logo.
 * - V4: portador de textos (PNG transparente na resolução do quadro, com todos os títulos e
 *   legendas animados numa composição Fusion). Textos ficam fora dos clipes para não herdarem o
 *   zoom do enquadramento e para legendas atravessarem cortes sem reiniciar a animação.
 * - A1/A2: áudio original dos trechos com fala (alternado como o vídeo).
 * - A3: trilha preparada (ganho, fades e ducking aplicados antes, ver `MusicPreparation`).
 */

import type { EditClip, EditMediaAsset, EditTextOverlay, EditTextPosition, EditTextStyle, VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import { validateVideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import { assertValidOperation, type BridgeOperation, type Keyframe, type TextLayerArgs } from "./bridge-protocol.js";

/** Calibração das convenções da API (confirmadas na prova ao vivo; ver docs/davinci-resolve-integration.md). */
export type ResolveConventions = {
  /** `endFrame` do clipInfo é inclusivo (quadro final incluído)? */
  endFrameInclusive: boolean;
  /** Sinal do Tilt: +1 quando Tilt positivo move a imagem para cima. */
  tiltSign: 1 | -1;
  /** Sinal do Pan: +1 quando Pan positivo move a imagem para a direita. */
  panSign: 1 | -1;
};

export const DEFAULT_CONVENTIONS: ResolveConventions = { endFrameInclusive: true, tiltSign: 1, panSign: 1 };

export const TEXT_CARRIER_FILE = "vorix-text-carrier.png";
export const PREPARED_MUSIC_FILE = "vorix-music-prepared.wav";

export type MusicPreparation = {
  sourceFileName: string;
  outputFileName: string;
  durationSeconds: number;
  gainDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  /** Janelas (segundos) em que a trilha cai `duckDb` para abrir espaço à fala. */
  duckWindows: { startSeconds: number; endSeconds: number }[];
  duckDb: number;
};

export type CompiledEditJob = {
  jobId: string;
  projectName: string;
  timelineName: string;
  outputBaseName: string;
  /** Arquivos que precisam existir na pasta do job antes da importação. */
  requiredFiles: string[];
  textCarrier?: { fileName: string; width: number; height: number };
  music?: MusicPreparation;
  /** Operações em ordem. `start_render` é a última; o acompanhamento é feito pelo executor. */
  operations: BridgeOperation[];
  /** Avisos honestos sobre o que não pôde ser aplicado como pedido. */
  warnings: string[];
  durationFrames: number;
};

const MAX_MOTION = 0.18;
const MAX_KEYFRAMES = 64;

function frames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Keyframes ordenados, sem quadro repetido (o último valor do quadro vence) e dentro de [0, max]. */
function normalize(keyframes: Keyframe[], maxFrame: number): Keyframe[] {
  const byFrame = new Map<number, number>();
  for (const kf of keyframes) {
    const f = Math.max(0, Math.min(maxFrame, Math.round(kf.f)));
    byFrame.set(f, round(kf.v));
  }
  const sorted = [...byFrame.entries()].sort((a, b) => a[0] - b[0]).map(([f, v]) => ({ f, v }));
  if (sorted.length <= MAX_KEYFRAMES) return sorted;
  const step = sorted.length / MAX_KEYFRAMES;
  return Array.from({ length: MAX_KEYFRAMES }, (_, index) => sorted[Math.min(sorted.length - 1, Math.round(index * step))]!);
}

function sample(track: Keyframe[], frame: number, fallback: number): number {
  if (track.length === 0) return fallback;
  if (frame <= track[0]!.f) return track[0]!.v;
  const last = track[track.length - 1]!;
  if (frame >= last.f) return last.v;
  for (let index = 1; index < track.length; index += 1) {
    const b = track[index]!;
    if (frame <= b.f) {
      const a = track[index - 1]!;
      return a.v + ((b.v - a.v) * (frame - a.f)) / (b.f - a.f);
    }
  }
  return last.v;
}

/** Combina duas curvas (soma ou produto) amostrando a união dos quadros-chave. */
function combine(a: Keyframe[], b: Keyframe[], neutral: number, op: (x: number, y: number) => number): Keyframe[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const framesUnion = [...new Set([...a.map((kf) => kf.f), ...b.map((kf) => kf.f)])].sort((x, y) => x - y);
  return framesUnion.map((f) => ({ f, v: op(sample(a, f, neutral), sample(b, f, neutral)) }));
}

/** Soma um deslocamento relativo a uma curva de posição; curva vazia = posição constante `base`. */
function addOffset(track: Keyframe[], offsets: Keyframe[], base: number): Keyframe[] {
  return combine(track.length > 0 ? track : [{ f: 0, v: base }], offsets, 0, (a, b) => a + b);
}

const OVERLAP_TRANSITIONS =new Set(["cross_dissolve", "push_left", "push_up", "zoom_in"]);

type ClipLayout = {
  clip: EditClip;
  asset: EditMediaAsset;
  track: 1 | 2;
  startFrame: number;
  durationFrames: number;
};

type ClipAnimation = { size: Keyframe[]; centerX: Keyframe[]; centerY: Keyframe[]; alpha: Keyframe[]; dip: Keyframe[] };

function emptyAnimation(): ClipAnimation {
  return { size: [], centerX: [], centerY: [], alpha: [], dip: [] };
}

function motionKeyframes(clip: EditClip, durationFrames: number): ClipAnimation {
  const animation = emptyAnimation();
  const amount = MAX_MOTION * clip.motion.intensity;
  const end = durationFrames;
  if (clip.motion.type === "static" || amount <= 0) return animation;
  const overscan = 1 + amount;
  const shift = (amount / 2) * 0.9;
  switch (clip.motion.type) {
    case "push_in":
      animation.size = [{ f: 0, v: 1 }, { f: end, v: overscan }];
      break;
    case "pull_out":
      animation.size = [{ f: 0, v: overscan }, { f: end, v: 1 }];
      break;
    case "pan_left":
      animation.size = [{ f: 0, v: overscan }, { f: end, v: overscan }];
      animation.centerX = [{ f: 0, v: 0.5 + shift }, { f: end, v: 0.5 - shift }];
      break;
    case "pan_right":
      animation.size = [{ f: 0, v: overscan }, { f: end, v: overscan }];
      animation.centerX = [{ f: 0, v: 0.5 - shift }, { f: end, v: 0.5 + shift }];
      break;
    case "pan_up":
      animation.size = [{ f: 0, v: overscan }, { f: end, v: overscan }];
      animation.centerY = [{ f: 0, v: 0.5 - shift }, { f: end, v: 0.5 + shift }];
      break;
    case "pan_down":
      animation.size = [{ f: 0, v: overscan }, { f: end, v: overscan }];
      animation.centerY = [{ f: 0, v: 0.5 + shift }, { f: end, v: 0.5 - shift }];
      break;
  }
  return animation;
}

/** Enquadramento estático do clipe (propriedades do Inspector), assumindo o projeto em "escalar para caber". */
function framingProperties(layout: ClipLayout, plan: VideoEditPlan, conventions: ResolveConventions, warnings: string[]) {
  const { asset, clip } = layout;
  if (clip.framing.fit === "fit") return undefined;
  if (!asset.width || !asset.height) {
    warnings.push(`clipe ${clip.id}: dimensões da mídia desconhecidas; mostrado inteiro (sem preencher o quadro)`);
    return undefined;
  }
  const fit = Math.min(plan.width / asset.width, plan.height / asset.height);
  const fill = Math.max(plan.width / asset.width, plan.height / asset.height);
  const zoom = fill / fit;
  if (zoom < 1.001) return undefined;
  const excessX = asset.width * fill - plan.width;
  const excessY = asset.height * fill - plan.height;
  const pan = (0.5 - clip.framing.focusX) * excessX * conventions.panSign;
  const tilt = (clip.framing.focusY - 0.5) * excessY * conventions.tiltSign;
  return { ZoomX: round(zoom), ZoomY: round(zoom), Pan: round(pan, 1), Tilt: round(tilt, 1) };
}

// ----- Texto -----

type TextWindow = { text: string; style: EditTextStyle; position: EditTextPosition; animation: EditTextOverlay["animation"]; startFrame: number; endFrame: number; isCaption: boolean };

const POSITION_Y: Record<"vertical" | "other", Record<EditTextPosition, number>> = {
  // 9:16: interface do Reels/TikTok cobre ~20% embaixo e ~10% em cima — áreas seguras.
  vertical: { top: 0.8, center: 0.52, lower_third: 0.34, bottom: 0.24 },
  other: { top: 0.86, center: 0.5, lower_third: 0.26, bottom: 0.12 },
};

/** Largura média de caractere ≈ 0.55 da altura da fonte (sans bold); margem lateral de 8%. */
export function wrapText(text: string, sizeOfHeight: number, width: number, height: number): { lines: string[]; size: number } {
  let size = sizeOfHeight;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const fontPx = size * height;
    const maxChars = Math.max(6, Math.floor((width * 0.84) / (fontPx * 0.56)));
    const lines: string[] = [];
    let current = "";
    let overflow = false;
    for (const word of text.trim().split(/\s+/)) {
      if (word.length > maxChars) overflow = true;
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
    if (!overflow && lines.length <= 3) return { lines, size: round(size) };
    size = Math.max(0.022, size * 0.88);
  }
  return { lines: [text.slice(0, 40)], size: 0.022 };
}

function textAnimation(window: TextWindow, maxFrame: number): Pick<TextLayerArgs, "alpha" | "dy" | "scale"> {
  const { startFrame: s, endFrame: e } = window;
  const fade = Math.max(1, Math.min(window.isCaption ? 3 : 6, Math.floor((e - s) / 4)));
  const alpha: Keyframe[] = window.animation === "none" || window.isCaption && fade < 2
    ? [...(s > 0 ? [{ f: s - 1, v: 0 }] : []), { f: s, v: 1 }, { f: e - 1, v: 1 }, { f: e, v: 0 }]
    : [...(s > 0 ? [{ f: s - 1, v: 0 }] : []), { f: s, v: s > 0 ? 0 : 1 }, { f: s + fade, v: 1 }, { f: e - fade, v: 1 }, { f: e, v: 0 }];
  const result: Pick<TextLayerArgs, "alpha" | "dy" | "scale"> = { alpha: normalize(alpha, maxFrame) };
  if (window.animation === "slide_up") result.dy = normalize([{ f: s, v: -0.035 }, { f: s + Math.max(fade + 2, 8), v: 0 }], maxFrame);
  if (window.animation === "pop") result.scale = normalize([{ f: s, v: 0.75 }, { f: s + 6, v: 1.06 }, { f: s + 10, v: 1 }], maxFrame);
  return result;
}

function overlapsInTime(a: TextWindow, b: TextWindow): boolean {
  return a.startFrame < b.endFrame && b.startFrame < a.endFrame;
}

/** Legenda que coincide no tempo com um título na mesma posição muda de posição — nunca empilha texto. */
function resolveCollisions(windows: TextWindow[], warnings: string[]): TextWindow[] {
  const titles = windows.filter((w) => !w.isCaption);
  return windows.map((window) => {
    if (!window.isCaption) return window;
    const clash = titles.find((title) => title.position === window.position && overlapsInTime(title, window));
    if (!clash) return window;
    const alternative: EditTextPosition = clash.position === "top" ? "lower_third" : "top";
    const stillClashing = titles.some((title) => title.position === alternative && overlapsInTime(title, window));
    if (stillClashing) warnings.push(`legenda "${window.text.slice(0, 24)}…" coincide com dois títulos; mantida em ${window.position}`);
    return stillClashing ? window : { ...window, position: alternative };
  });
}

export type CompileOptions = { jobId: string; conventions?: ResolveConventions; fontFamily?: string };

export class PlanCompilationError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "PlanCompilationError";
  }
}

export function compileEditPlan(plan: VideoEditPlan, options: CompileOptions): CompiledEditJob {
  const validation = validateVideoEditPlan(plan);
  if (!validation.valid) {
    throw new PlanCompilationError("Plano de edição inválido; nada foi enviado ao DaVinci.", validation.issues.map((issue) => `${issue.path}: ${issue.message}`));
  }
  const unsupported = [
    ...plan.assets.filter((asset) => asset.kind === "card").map((asset) => `cartão "${asset.id}"`),
    ...(plan.narration ? ["narração"] : []),
    ...plan.clips.filter((clip) => clip.layout && clip.layout !== "full").map((clip) => `composição "${clip.layout}"`),
    ...plan.clips.filter((clip) => clip.framing.region).map((clip) => `região de origem em "${clip.id}"`),
    ...plan.clips.filter((clip) => ["punch_in", "drift"].includes(clip.motion.type)).map((clip) => `movimento "${clip.motion.type}"`),
    ...plan.clips.filter((clip) => ["blur", "circle_open", "wipe", "flash", "smooth_left"].includes(clip.transitionIn.type)).map((clip) => `transição "${clip.transitionIn.type}"`),
    ...plan.clips.flatMap((clip) => clip.overlays).filter((overlay) => overlay.animation === "kinetic").map(() => "texto cinético"),
    ...plan.clips.flatMap((clip) => clip.overlays).filter((overlay) => overlay.animation === "countdown").map(() => "contagem sobreposta"),
  ];
  if (unsupported.length > 0) throw new PlanCompilationError(`Recursos não suportados pelo executor DaVinci (estacionado): ${unsupported.join(", ")}.`);
  const conventions = options.conventions ?? DEFAULT_CONVENTIONS;
  const fontFamily = options.fontFamily ?? "Arial";
  const { fps } = plan;
  const warnings: string[] = [];
  const assets = new Map(plan.assets.map((asset) => [asset.id, asset]));
  const totalFrames = frames(plan.durationSeconds, fps);
  const endOffset = conventions.endFrameInclusive ? 1 : 0;

  // Layout dos clipes em quadros (derivado do início de cada clipe para não acumular arredondamento).
  const layouts: ClipLayout[] = plan.clips.map((clip, index) => {
    const startFrame = frames(clip.recordStartSeconds, fps);
    const endFrame = frames(clip.recordStartSeconds + clip.durationSeconds, fps);
    return { clip, asset: assets.get(clip.assetId)!, track: (index % 2 === 0 ? 1 : 2) as 1 | 2, startFrame, durationFrames: endFrame - startFrame };
  });

  // Animações por clipe: movimento de câmera + transições de entrada/saída.
  const animations = layouts.map((layout) => motionKeyframes(layout.clip, layout.durationFrames));
  layouts.forEach((layout, index) => {
    const transition = layout.clip.transitionIn;
    const d = Math.max(1, frames(transition.durationSeconds, fps));
    const incoming = animations[index]!;
    if (index === 0) {
      if (transition.type !== "cut") incoming.dip = [{ f: 0, v: 1 }, { f: d, v: 0 }];
      return;
    }
    const previous = layouts[index - 1]!;
    const outgoing = animations[index - 1]!;
    const outEnd = previous.durationFrames;
    const incomingIsUpper = layout.track > previous.track;
    if (transition.type === "dip_to_black") {
      const half = Math.max(1, Math.round(d / 2));
      outgoing.dip = combine(outgoing.dip, [{ f: outEnd - half, v: 0 }, { f: outEnd, v: 1 }], 0, (a, b) => Math.max(a, b));
      incoming.dip = combine(incoming.dip, [{ f: 0, v: 1 }, { f: half, v: 0 }], 0, (a, b) => Math.max(a, b));
      return;
    }
    if (!OVERLAP_TRANSITIONS.has(transition.type)) return;
    // Só o clipe de cima precisa mudar de opacidade para o dissolve aparecer.
    const dissolveIn: Keyframe[] = [{ f: 0, v: 0 }, { f: d, v: 1 }];
    const dissolveOut: Keyframe[] = [{ f: outEnd - d, v: 1 }, { f: outEnd, v: 0 }];
    if (transition.type === "cross_dissolve" || transition.type === "zoom_in") {
      if (incomingIsUpper) incoming.alpha = combine(incoming.alpha, dissolveIn, 1, Math.min);
      else outgoing.alpha = combine(outgoing.alpha, dissolveOut, 1, Math.min);
    }
    if (transition.type === "zoom_in") {
      outgoing.size = combine(outgoing.size, [{ f: outEnd - d, v: 1 }, { f: outEnd, v: 1.35 }], 1, (a, b) => a * b);
      incoming.size = combine(incoming.size, [{ f: 0, v: 0.85 }, { f: d, v: 1 }], 1, (a, b) => a * b);
    }
    if (transition.type === "push_left") {
      incoming.centerX = addOffset(incoming.centerX, [{ f: 0, v: 1.0 }, { f: d, v: 0 }], 0.5);
      outgoing.centerX = addOffset(outgoing.centerX, [{ f: outEnd - d, v: 0 }, { f: outEnd, v: -1.0 }], 0.5);
    }
    if (transition.type === "push_up") {
      incoming.centerY = addOffset(incoming.centerY, [{ f: 0, v: -1.0 }, { f: d, v: 0 }], 0.5);
      outgoing.centerY = addOffset(outgoing.centerY, [{ f: outEnd - d, v: 0 }, { f: outEnd, v: 1.0 }], 0.5);
    }
  });

  const operations: BridgeOperation[] = [];
  const projectName = `Vorix ${options.jobId}`.slice(0, 80);
  const timelineName = `Timeline ${plan.planId}`.slice(0, 80).replace(/[^A-Za-z0-9 _-]/g, "-");

  const usedAssetIds = new Set<string>(plan.clips.map((clip) => clip.assetId));
  if (plan.logo) usedAssetIds.add(plan.logo.assetId);
  const requiredFiles = plan.assets.filter((asset) => usedAssetIds.has(asset.id) && asset.kind !== "audio").map((asset) => asset.fileName!);

  // Texto
  const textWindows: TextWindow[] = [];
  for (const layout of layouts) {
    for (const overlay of layout.clip.overlays) {
      const startFrame = layout.startFrame + frames(overlay.startOffsetSeconds, fps);
      textWindows.push({ text: overlay.text, style: overlay.style, position: overlay.position, animation: overlay.animation, startFrame, endFrame: Math.min(totalFrames, startFrame + Math.max(1, frames(overlay.durationSeconds, fps))), isCaption: false });
    }
  }
  if (plan.captions?.enabled) {
    for (const segment of plan.captions.segments) {
      textWindows.push({ text: segment.text, style: plan.captions.style, position: plan.captions.position, animation: "fade", startFrame: frames(segment.startSeconds, fps), endFrame: Math.min(totalFrames, frames(segment.endSeconds, fps)), isCaption: true });
    }
  }
  const resolvedText = resolveCollisions(textWindows, warnings).filter((window) => window.endFrame > window.startFrame);
  const orientation = plan.aspect === "9:16" ? "vertical" : "other";
  const textLayers: TextLayerArgs[] = resolvedText.map((window) => {
    const wrapped = wrapText(window.text, window.style.size, plan.width, plan.height);
    if (wrapped.size < window.style.size) warnings.push(`texto "${window.text.slice(0, 24)}…" reduzido para caber em 3 linhas`);
    const layer: TextLayerArgs = {
      text: wrapped.lines.join("\n"),
      size: wrapped.size,
      colorHex: window.style.colorHex.toUpperCase(),
      bold: window.style.bold ?? true,
      fontFamily: window.style.fontFamily ?? fontFamily,
      x: 0.5,
      y: POSITION_Y[orientation][window.position],
      bandHeight: round(Math.min(0.6, wrapped.lines.length * wrapped.size * 1.3 + wrapped.size * 0.9)),
      ...textAnimation(window, totalFrames),
    };
    if (window.style.backgroundHex) layer.bandHex = window.style.backgroundHex.toUpperCase();
    return layer;
  });

  const textCarrier = textLayers.length > 0 ? { fileName: TEXT_CARRIER_FILE, width: plan.width, height: plan.height } : undefined;

  // Trilha preparada fora do DaVinci (a API não expõe ganho/automação do Fairlight).
  let music: MusicPreparation | undefined;
  if (plan.music) {
    const asset = assets.get(plan.music.assetId)!;
    const speech = plan.music.duckUnderSpeech ? layouts.filter((layout) => layout.clip.keepSourceAudio).map((layout) => ({ startSeconds: round(layout.startFrame / fps, 3), endSeconds: round((layout.startFrame + layout.durationFrames) / fps, 3) })) : [];
    const merged: { startSeconds: number; endSeconds: number }[] = [];
    for (const window of speech) {
      const last = merged[merged.length - 1];
      if (last && window.startSeconds <= last.endSeconds + 0.3) last.endSeconds = Math.max(last.endSeconds, window.endSeconds);
      else merged.push({ ...window });
    }
    if ((asset.sourceDurationSeconds ?? 0) + 0.05 < plan.durationSeconds) warnings.push("trilha mais curta que o vídeo: termina antes do fim");
    music = { sourceFileName: asset.fileName!, outputFileName: PREPARED_MUSIC_FILE, durationSeconds: plan.durationSeconds, gainDb: plan.music.gainDb, fadeInSeconds: plan.music.fadeInSeconds, fadeOutSeconds: plan.music.fadeOutSeconds, duckWindows: merged, duckDb: 10 };
  }
  if (plan.sourceAudioGainDb !== 0) warnings.push("ganho do áudio original não aplicado nesta versão (a API do DaVinci não expõe o volume do clipe)");

  const importFiles = [...requiredFiles, ...(textCarrier ? [textCarrier.fileName] : []), ...(music ? [music.outputFileName] : [])];

  operations.push({ op: "create_project", args: { name: projectName, width: plan.width, height: plan.height, fps } });
  operations.push({ op: "import_media", args: { jobId: options.jobId, files: importFiles } });
  operations.push({ op: "create_timeline", args: { name: timelineName } });
  const videoTracks = 2 + (plan.logo ? 1 : 0) + (textCarrier ? 1 : 0);
  for (let track = 2; track <= Math.max(videoTracks, 2); track += 1) operations.push({ op: "add_track", args: { type: "video" } });
  const audioTracksNeeded = Math.max(layouts.some((l) => l.clip.keepSourceAudio && l.track === 2) ? 2 : 1, music ? 3 : 1);
  for (let track = 2; track <= audioTracksNeeded; track += 1) operations.push({ op: "add_track", args: { type: "audio" } });

  layouts.forEach((layout, index) => {
    const { clip, asset } = layout;
    const ref = `clip-${index + 1}`;
    const srcStart = asset.kind === "video" ? frames(clip.sourceInSeconds, fps) : 0;
    operations.push({ op: "append_clip", args: { ref, jobId: options.jobId, fileName: asset.fileName!, startFrame: srcStart, endFrame: srcStart + layout.durationFrames - endOffset, trackIndex: layout.track, recordFrame: layout.startFrame, mediaType: 1 } });
    if (clip.keepSourceAudio) {
      operations.push({ op: "append_clip", args: { ref: `${ref}-audio`, jobId: options.jobId, fileName: asset.fileName!, startFrame: srcStart, endFrame: srcStart + layout.durationFrames - endOffset, trackIndex: layout.track, recordFrame: layout.startFrame, mediaType: 2 } });
    }
    const props = framingProperties(layout, plan, conventions, warnings);
    if (props) operations.push({ op: "set_clip_properties", args: { ref, props } });
    const animation = animations[index]!;
    const max = layout.durationFrames;
    const style = {
      size: normalize(animation.size, max),
      centerX: normalize(animation.centerX, max),
      centerY: normalize(animation.centerY, max),
      alpha: normalize(animation.alpha, max),
      dip: normalize(animation.dip, max),
    };
    const keys = (Object.keys(style) as (keyof typeof style)[]).filter((key) => style[key].length > 0);
    if (keys.length > 0) {
      operations.push({ op: "style_clip", args: { ref, durationFrames: max, ...Object.fromEntries(keys.map((key) => [key, style[key]])) } });
    }
  });

  let nextVideoTrack = 3;
  if (plan.logo) {
    const asset = assets.get(plan.logo.assetId)!;
    if (!asset.width || !asset.height) throw new PlanCompilationError("Logo sem dimensões conhecidas; não é possível posicioná-lo sem distorcer.");
    const startFrame = frames(plan.logo.startSeconds, fps);
    const durationFrames = Math.min(totalFrames - startFrame, frames(plan.logo.durationSeconds, fps));
    const track = nextVideoTrack++;
    operations.push({ op: "append_clip", args: { ref: "logo", jobId: options.jobId, fileName: asset.fileName!, startFrame: 0, endFrame: durationFrames - endOffset, trackIndex: track, recordFrame: startFrame, mediaType: 1 } });
    const fit = Math.min(plan.width / asset.width, plan.height / asset.height);
    const zoom = (plan.logo.scale * plan.width) / (asset.width * fit);
    const shownW = asset.width * fit * zoom;
    const shownH = asset.height * fit * zoom;
    const margin = 0.05 * Math.min(plan.width, plan.height);
    const safeTop = plan.aspect === "9:16" ? plan.height * 0.1 : margin;
    const safeBottom = plan.aspect === "9:16" ? plan.height * 0.2 : margin;
    const cx = plan.logo.placement.endsWith("left") ? margin + shownW / 2 : plan.logo.placement.endsWith("right") ? plan.width - margin - shownW / 2 : plan.width / 2;
    const cy = plan.logo.placement.startsWith("top") ? safeTop + shownH / 2 : plan.logo.placement.startsWith("bottom") ? plan.height - safeBottom - shownH / 2 : plan.height / 2;
    operations.push({ op: "set_clip_properties", args: { ref: "logo", props: { ZoomX: round(zoom), ZoomY: round(zoom), Pan: round((cx - plan.width / 2) * conventions.panSign, 1), Tilt: round((plan.height / 2 - cy) * conventions.tiltSign, 1) } } });
    const fade = Math.min(8, Math.floor(durationFrames / 4));
    operations.push({ op: "style_clip", args: { ref: "logo", durationFrames, alpha: normalize([{ f: 0, v: 0 }, { f: fade, v: 1 }, { f: durationFrames - fade, v: 1 }, { f: durationFrames, v: 0 }], durationFrames) } });
  }

  if (textCarrier) {
    const track = nextVideoTrack++;
    operations.push({ op: "append_clip", args: { ref: "text", jobId: options.jobId, fileName: textCarrier.fileName, startFrame: 0, endFrame: totalFrames - endOffset, trackIndex: track, recordFrame: 0, mediaType: 1 } });
    operations.push({ op: "build_text_layer", args: { ref: "text", durationFrames: totalFrames, layers: textLayers } });
  }

  if (music) {
    operations.push({ op: "append_clip", args: { ref: "music", jobId: options.jobId, fileName: music.outputFileName, startFrame: 0, endFrame: Math.min(totalFrames, frames(Math.min(music.durationSeconds, assets.get(plan.music!.assetId)!.sourceDurationSeconds ?? music.durationSeconds), fps)) - endOffset, trackIndex: 3, recordFrame: 0, mediaType: 2 } });
  }

  const outputBaseName = `vorix-${options.jobId}`.slice(0, 80);
  operations.push({ op: "set_render", args: { jobId: options.jobId, fileName: outputBaseName, width: plan.width, height: plan.height, fps } });
  operations.push({ op: "save_project", args: {} });
  operations.push({ op: "start_render", args: {} });

  for (const operation of operations) assertValidOperation(operation);

  return { jobId: options.jobId, projectName, timelineName, outputBaseName, requiredFiles, textCarrier, music, operations, warnings, durationFrames: totalFrames };
}
