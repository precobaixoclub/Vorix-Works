/**
 * Compilador: plano de edição validado → passos do FFmpeg (puro, sem I/O).
 *
 * Passos:
 * 1. base (só foto/cartão): 1 quadro em supersampling 2×, com enquadramento (preencher com foco,
 *    ou mostrar inteiro sobre fundo desfocado da própria imagem). Calculado uma vez por clipe.
 * 2. clipe: movimento de câmera (escala contínua por quadro + recorte, sem o tremor do zoompan),
 *    fades de abertura/dip, normalização (fps, yuv420p). Gera um intermediário H.264 de alta
 *    qualidade com exatamente N quadros. Re-render de edição só refaz os clipes que mudaram.
 * 3. áudio do trecho (vídeo com fala): corte exato e fades curtos contra estalos.
 * 4. montagem: transições (xfade/concat), títulos e legendas (ASS), logo, mixagem (fala/narração,
 *    trilha com ducking por sidechain) e loudness −14 LUFS; H.264 + AAC com faststart.
 *
 * Todos os caminhos são nomes simples relativos à pasta do job (o executor roda o FFmpeg com
 * cwd = pasta do job). Nada do plano vira argumento livre: números são formatados aqui e textos
 * vão para o arquivo ASS escapados.
 */

import { createHash } from "node:crypto";
import type { EditClip, EditMediaAsset, VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import { validateVideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";

export type MediaFacts = Record<string, { hasAudio: boolean; durationSeconds?: number | null; width?: number; height?: number }>;

export type FfmpegEditOptions = {
  /** Preset do x264 na montagem final. */
  preset: "ultrafast" | "veryfast" | "faster" | "fast" | "medium";
  crf: number;
  threads: number;
  /** Supersampling das fotos (1 ou 2). 2 = movimento mais suave, mais CPU. */
  supersample: 1 | 2;
  /** Arquivo ASS e pasta de fontes já preparados pelo executor (nomes relativos). */
  assFile?: string;
  fontsDir?: string;
};

export const DEFAULT_FFMPEG_EDIT_OPTIONS: FfmpegEditOptions = { preset: "medium", crf: 20, threads: 2, supersample: 2 };

/** Muda quando a forma de gerar intermediários muda: invalida o cache antigo. */
export const FFMPEG_EDIT_COMPILER_VERSION = "ffmpeg-edit-3";

export type FfmpegStep = { kind: "base" | "clip" | "audio" | "final"; id: string; output: string; args: string[]; timeoutMs: number; cacheKey?: string; frames?: number };

export type CompiledFfmpegEdit = {
  steps: FfmpegStep[];
  output: string;
  totalFrames: number;
  hasAudio: boolean;
  warnings: string[];
};

export class FfmpegPlanError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "FfmpegPlanError";
  }
}

const OVERLAP: Record<string, string | undefined> = { cross_dissolve: "fade", push_left: "slideleft", push_up: "slideup", zoom_in: "zoomin" };
const MAX_MOTION = 0.18;

const n = (value: number, digits = 4) => {
  if (!Number.isFinite(value)) throw new FfmpegPlanError("valor numérico inválido no plano");
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
};
const even = (value: number) => 2 * Math.round(value / 2);
const hex = (value: string) => `0x${value.slice(1).toUpperCase()}`;

/** Progresso suavizado (smoothstep) de 0 a 1 ao longo de D segundos, como expressão do FFmpeg. */
function ease(duration: number): string {
  return `st(0\\,clip(t/${n(duration)}\\,0\\,1));ld(0)*ld(0)*(3-2*ld(0))`;
}

type Motion = { zoomFrom: number; zoomTo: number; shiftX: [number, number]; shiftY: [number, number] };

function motionOf(clip: EditClip): Motion | null {
  const amount = MAX_MOTION * clip.motion.intensity;
  if (clip.motion.type === "static" || amount <= 0.001) return null;
  const over = 1 + amount;
  const shift = (amount / 2) * 0.9;
  switch (clip.motion.type) {
    case "push_in":
      return { zoomFrom: 1, zoomTo: over, shiftX: [0, 0], shiftY: [0, 0] };
    case "pull_out":
      return { zoomFrom: over, zoomTo: 1, shiftX: [0, 0], shiftY: [0, 0] };
    case "pan_left":
      return { zoomFrom: over, zoomTo: over, shiftX: [shift, -shift], shiftY: [0, 0] };
    case "pan_right":
      return { zoomFrom: over, zoomTo: over, shiftX: [-shift, shift], shiftY: [0, 0] };
    case "pan_up":
      return { zoomFrom: over, zoomTo: over, shiftX: [0, 0], shiftY: [-shift, shift] };
    case "pan_down":
      return { zoomFrom: over, zoomTo: over, shiftX: [0, 0], shiftY: [shift, -shift] };
    default:
      return null;
  }
}

/**
 * Fotos/cartões: `zoompan` sobre a base em supersampling recorta só a janela visível e reduz direto
 * para a saída (barato), com passo de meio pixel — sem o tremor do zoompan em 1×.
 */
function zoompanFilter(motion: Motion | null, duration: number, fps: number, W: number, H: number): string {
  if (!motion) return `scale=${W}:${H}:flags=lanczos`;
  const p = `st(0\\,clip(on/${fps}/${n(duration)}\\,0\\,1));ld(0)*ld(0)*(3-2*ld(0))`;
  const z = `${n(motion.zoomFrom)}+(${n(motion.zoomTo - motion.zoomFrom)})*(${p})`;
  const dx = `(${n(motion.shiftX[0])}+(${n(motion.shiftX[1] - motion.shiftX[0])})*(${p}))`;
  const dy = `(${n(motion.shiftY[0])}+(${n(motion.shiftY[1] - motion.shiftY[0])})*(${p}))`;
  return `zoompan=z='${z}':x='max(0\\,min(iw-iw/zoom\\,(iw-iw/zoom)/2-${dx}*iw/zoom))':y='max(0\\,min(ih-ih/zoom\\,(ih-ih/zoom)/2+${dy}*ih/zoom))':d=1:s=${W}x${H}:fps=${fps}`;
}

/** Vídeo: escala por quadro + recorte fixo (zoom contínuo; deslocamento com passo de 1 px). */
function motionFilter(motion: Motion, duration: number, cw: number, ch: number): string {
  const e = ease(duration);
  const z = `(${n(motion.zoomFrom)}+(${n(motion.zoomTo - motion.zoomFrom)})*(${e}))`;
  const dx = `(${n(motion.shiftX[0])}+(${n(motion.shiftX[1] - motion.shiftX[0])})*(${e}))`;
  const dy = `(${n(motion.shiftY[0])}+(${n(motion.shiftY[1] - motion.shiftY[0])})*(${e}))`;
  return [
    `scale=w='2*trunc(${cw}*${z}/2)':h='2*trunc(${ch}*${z}/2)':eval=frame:flags=bicubic`,
    // Imagem desloca dx para a direita → janela de recorte vai para a esquerda.
    `crop=${cw}:${ch}:x='max(0\\,min(iw-ow\\,(iw-ow)/2-(${dx})*ow))':y='max(0\\,min(ih-oh\\,(ih-oh)/2+(${dy})*oh))'`,
  ].join(",");
}

/** Enquadramento: preencher (corte pelo foco) ou mostrar inteiro sobre fundo desfocado da própria mídia. */
function framingFilter(clip: EditClip, cw: number, ch: number): string {
  const zoom = clip.framing.zoom ?? 1;
  const zoomTail = zoom > 1.001 ? `,scale=${even(cw * zoom)}:${even(ch * zoom)}:flags=lanczos,crop=${cw}:${ch}:x='(iw-ow)*${n(clip.framing.focusX)}':y='(ih-oh)*${n(clip.framing.focusY)}'` : "";
  return baseFraming(clip, cw, ch) + zoomTail;
}

function baseFraming(clip: EditClip, cw: number, ch: number): string {
  if (clip.framing.fit === "fill") {
    return `scale=${cw}:${ch}:force_original_aspect_ratio=increase:flags=lanczos,crop=${cw}:${ch}:x='(iw-ow)*${n(clip.framing.focusX)}':y='(ih-oh)*${n(clip.framing.focusY)}',setsar=1`;
  }
  // Desfoque barato e forte: reduz 24×, desfoca, amplia; escurecido para virar campo de cor.
  const sw = even(cw / 24);
  const sh = even(ch / 24);
  return [
    "split=2[fa][fb]",
    `[fa]scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},scale=${sw}:${sh},gblur=sigma=10,scale=${cw}:${ch}:flags=bicubic,eq=brightness=-0.2:saturation=0.6[fbg]`,
    `[fb]scale=${cw}:${ch}:force_original_aspect_ratio=decrease:flags=lanczos[ffg]`,
    `[fbg][ffg]overlay=x=(W-w)/2:y=(H-h)/2,setsar=1`,
  ].join(";");
}

function cardSource(asset: EditMediaAsset, cw: number, ch: number): string {
  return `color=c=${hex(asset.card!.colorHex)}:s=${cw}x${ch}:r=1:d=1`;
}

/** Gradiente vertical linear calculado por pixel (uma vez, na base do cartão). */
function cardGradient(asset: EditMediaAsset): string {
  const card = asset.card!;
  if (!card.gradientToHex) return "null";
  const rgb = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const [r0, g0, b0] = rgb(card.colorHex);
  const [r1, g1, b1] = rgb(card.gradientToHex);
  const channel = (a: number, b: number) => `'${a}+(${b - a})*Y/H'`;
  return `geq=r=${channel(r0!, r1!)}:g=${channel(g0!, g1!)}:b=${channel(b0!, b1!)}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export type CompileFfmpegInput = { plan: VideoEditPlan; facts: MediaFacts; options?: Partial<FfmpegEditOptions>; outputName?: string; logoFile?: string };

export function compileFfmpegEdit(input: CompileFfmpegInput): CompiledFfmpegEdit {
  const { plan, facts } = input;
  const validation = validateVideoEditPlan(plan);
  if (!validation.valid) throw new FfmpegPlanError("Plano de edição inválido; nada foi renderizado.", validation.issues.map((issue) => `${issue.path}: ${issue.message}`));
  const options = { ...DEFAULT_FFMPEG_EDIT_OPTIONS, ...input.options };
  const { width: W, height: H, fps } = plan;
  const output = input.outputName ?? "final.mp4";
  const warnings: string[] = [];
  const assets = new Map(plan.assets.map((asset) => [asset.id, asset]));
  const threads = String(Math.max(1, Math.min(8, Math.round(options.threads))));
  /** `-threads` vale por arquivo no FFmpeg: aplica a cada entrada, senão cada decodificador usa todos os núcleos (e memória). */
  const limitInputs = (args: string[]) => args.flatMap((arg, index) => (arg === "-i" && args[index - 1] !== "-threads" ? ["-threads", threads, arg] : [arg]));
  const steps: FfmpegStep[] = [];
  const totalFrames = Math.round(plan.durationSeconds * fps);

  // Layout em quadros, derivado do início de cada clipe (sem acumular arredondamento).
  const layout = plan.clips.map((clip) => {
    const start = Math.round(clip.recordStartSeconds * fps);
    const end = Math.round((clip.recordStartSeconds + clip.durationSeconds) * fps);
    return { clip, asset: assets.get(clip.assetId)!, startFrame: start, frames: end - start };
  });

  // Fades dentro dos clipes: abertura e dip to black (sem sobreposição).
  const fadeIn = new Map<number, number>();
  const fadeOut = new Map<number, number>();
  layout.forEach(({ clip }, index) => {
    const t = clip.transitionIn;
    if (index === 0 && t.type !== "cut") fadeIn.set(0, t.durationSeconds);
    if (index > 0 && t.type === "dip_to_black") {
      fadeOut.set(index - 1, t.durationSeconds / 2);
      fadeIn.set(index, t.durationSeconds / 2);
    }
  });

  const clipFiles: string[] = [];
  layout.forEach(({ clip, asset, frames }, index) => {
    const duration = frames / fps;
    const isVideo = asset.kind === "video";
    const ss = isVideo ? 1 : options.supersample;
    const cw = even(W * ss);
    const ch = even(H * ss);
    const motion = motionOf(clip);
    const fades: string[] = [];
    if (fadeIn.has(index)) fades.push(`fade=t=in:st=0:d=${n(fadeIn.get(index)!)}`);
    if (fadeOut.has(index)) fades.push(`fade=t=out:st=${n(Math.max(0, duration - fadeOut.get(index)!))}:d=${n(fadeOut.get(index)!)}`);
    const tail = [...(ss > 1 ? [`scale=${W}:${H}:flags=lanczos`] : []), ...fades, `fps=${fps}`, "format=yuv420p", "setsar=1"].join(",");

    let inputArgs: string[];
    let chain: string;
    if (isVideo) {
      if (!asset.fileName) throw new FfmpegPlanError(`asset ${asset.id} sem arquivo`);
      inputArgs = ["-ss", n(clip.sourceInSeconds, 3), "-t", n(duration + 0.5, 3), "-i", asset.fileName];
      const framing = framingFilter(clip, cw, ch);
      chain = `[0:v]setpts=PTS-STARTPTS,fps=${fps},${framing}${motion ? `,${motionFilter(motion, duration, cw, ch)}` : ""},${tail}[v]`;
    } else {
      const baseName = `base-${index + 1}-${hash({ a: asset, f: clip.framing, cw, ch })}.png`;
      const baseInput = asset.kind === "card" ? ["-f", "lavfi", "-i", cardSource(asset, cw, ch)] : ["-i", asset.fileName!];
      const baseChain = asset.kind === "card" ? `[0:v]format=rgb24,${cardGradient(asset)},setsar=1[b]` : `[0:v]format=rgb24,${framingFilter(clip, cw, ch)}[b]`;
      steps.push({ kind: "base", id: clip.id, output: baseName, args: ["-hide_banner", "-y", ...limitInputs(baseInput), "-filter_complex", baseChain, "-map", "[b]", "-frames:v", "1", "-update", "1", baseName], timeoutMs: 60_000, cacheKey: "cacheable" });
      inputArgs = ["-loop", "1", "-framerate", String(fps), "-t", n(duration + 0.5, 3), "-i", baseName];
      const imageTail = [...fades, `fps=${fps}`, "format=yuv420p", "setsar=1"].join(",");
      chain = `[0:v]setpts=PTS-STARTPTS,${zoompanFilter(motion, duration, fps, W, H)},${imageTail}[v]`;
    }
    const spec = { inputArgs, chain, frames, fps, W, H };
    const clipName = `clip-${index + 1}-${hash(spec)}.mp4`;
    steps.push({
      kind: "clip",
      id: clip.id,
      output: clipName,
      frames,
      cacheKey: "cacheable",
      timeoutMs: Math.max(60_000, Math.round(duration * 30_000)),
      args: ["-hide_banner", "-y", "-filter_complex_threads", threads, ...limitInputs(inputArgs), "-filter_complex", chain, "-map", "[v]", "-an", "-frames:v", String(frames), "-threads", threads, "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(fps), clipName],
    });
    clipFiles.push(clipName);
  });

  // Áudio original dos trechos com fala.
  const speech: { file: string; startSeconds: number }[] = [];
  layout.forEach(({ clip, asset, startFrame, frames }, index) => {
    if (!clip.keepSourceAudio) return;
    if (!facts[asset.id]?.hasAudio) {
      warnings.push(`clipe ${clip.id}: a mídia não tem áudio; trecho sem fala`);
      return;
    }
    const duration = frames / fps;
    const next = layout[index + 1];
    const overlapIn = index > 0 && OVERLAP[clip.transitionIn.type] ? clip.transitionIn.durationSeconds : 0.02;
    const overlapOut = next && OVERLAP[next.clip.transitionIn.type] ? next.clip.transitionIn.durationSeconds : 0.03;
    const file = `speech-${index + 1}-${hash({ s: clip.sourceInSeconds, d: duration, f: asset.fileName })}.wav`;
    steps.push({
      kind: "audio",
      id: clip.id,
      output: file,
      timeoutMs: 60_000,
      args: ["-hide_banner", "-y", "-ss", n(clip.sourceInSeconds, 3), "-t", n(duration, 3), "-threads", threads, "-i", asset.fileName!, "-vn", "-af", `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${n(plan.sourceAudioGainDb, 1)}dB,afade=t=in:st=0:d=${n(overlapIn, 3)},afade=t=out:st=${n(Math.max(0, duration - overlapOut), 3)}:d=${n(overlapOut, 3)}`, "-c:a", "pcm_s16le", file],
    });
    speech.push({ file, startSeconds: startFrame / fps });
  });

  // ---------- Montagem final ----------
  const inputs: string[] = [];
  clipFiles.forEach((file) => inputs.push("-i", file));
  let nextInput = clipFiles.length;
  const filters: string[] = [];

  // Mesma base de tempo e frame rate constante declarado: o concat muda a base (1/1000000) e perde o
  // frame rate (1/0); o xfade exige os dois (o FFmpeg 7 de produção recusa, o 6.1 tolerava).
  clipFiles.forEach((_, index) => filters.push(`[${index}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${fps}[c${index}]`));
  let current = "[c0]";
  let currentDuration = layout[0]!.frames / fps;
  for (let index = 1; index < layout.length; index += 1) {
    const { clip, frames } = layout[index]!;
    const transition = OVERLAP[clip.transitionIn.type];
    const label = `[x${index}]`;
    if (transition) {
      const d = clip.transitionIn.durationSeconds;
      filters.push(`${current}[c${index}]xfade=transition=${transition}:duration=${n(d)}:offset=${n(currentDuration - d)}${label}`);
      currentDuration += frames / fps - d;
    } else {
      filters.push(`${current}[c${index}]concat=n=2:v=1:a=0,fps=${fps}${label}`);
      currentDuration += frames / fps;
    }
    current = label;
  }

  if (options.assFile) {
    const fonts = options.fontsDir ? `:fontsdir=${options.fontsDir}` : "";
    filters.push(`${current}ass=filename=${options.assFile}${fonts}[vt]`);
    current = "[vt]";
  }

  if (plan.logo) {
    const asset = assets.get(plan.logo.assetId)!;
    const logoFile = input.logoFile ?? asset.fileName!;
    const facts0 = facts[asset.id];
    const aw = facts0?.width ?? asset.width;
    const ah = facts0?.height ?? asset.height;
    if (!aw || !ah) throw new FfmpegPlanError("Logo sem dimensões conhecidas; não é possível posicioná-lo sem distorcer.");
    const lw = even(plan.logo.scale * W);
    const lh = even((lw * ah) / aw);
    const margin = Math.round(0.05 * Math.min(W, H));
    const safeTop = plan.aspect === "9:16" ? Math.round(H * 0.1) : margin;
    const safeBottom = plan.aspect === "9:16" ? Math.round(H * 0.2) : margin;
    const placement = plan.logo.placement;
    const x = placement.endsWith("left") ? margin : placement.endsWith("right") ? W - margin - lw : Math.round((W - lw) / 2);
    const y = placement.startsWith("top") ? safeTop : placement.startsWith("bottom") ? H - safeBottom - lh : Math.round((H - lh) / 2);
    const a = plan.logo.startSeconds;
    const b = plan.logo.startSeconds + plan.logo.durationSeconds;
    const f = Math.min(0.4, plan.logo.durationSeconds / 4);
    inputs.push("-loop", "1", "-framerate", String(fps), "-t", n(plan.durationSeconds + 0.5, 3), "-i", logoFile);
    filters.push(`[${nextInput}:v]format=rgba,scale=${lw}:${lh}:flags=lanczos,fade=t=in:st=${n(a)}:d=${n(f)}:alpha=1,fade=t=out:st=${n(b - f)}:d=${n(f)}:alpha=1[lg]`);
    filters.push(`${current}[lg]overlay=x=${x}:y=${y}:enable='between(t\\,${n(a)}\\,${n(b)})'[vl]`);
    current = "[vl]";
    nextInput += 1;
  }
  filters.push(`${current}format=yuv420p,setsar=1[vout]`);

  // Áudio: fala (trechos + narração), trilha com ducking por sidechain, loudness final.
  const T = plan.durationSeconds;
  const speechLabels: string[] = [];
  speech.forEach((item, index) => {
    inputs.push("-i", item.file);
    const ms = Math.round(item.startSeconds * 1000);
    filters.push(`[${nextInput}:a]adelay=${ms}:all=1[sp${index}]`);
    speechLabels.push(`[sp${index}]`);
    nextInput += 1;
  });
  if (plan.narration) {
    const asset = assets.get(plan.narration.assetId)!;
    inputs.push("-i", asset.fileName!);
    filters.push(`[${nextInput}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${n(plan.narration.gainDb, 1)}dB,adelay=${Math.round(plan.narration.startSeconds * 1000)}:all=1[nar]`);
    speechLabels.push("[nar]");
    nextInput += 1;
  }
  let speechBus: string | null = null;
  if (speechLabels.length === 1) speechBus = speechLabels[0]!;
  else if (speechLabels.length > 1) {
    filters.push(`${speechLabels.join("")}amix=inputs=${speechLabels.length}:normalize=0:duration=longest[speech]`);
    speechBus = "[speech]";
  }
  let musicBus: string | null = null;
  if (plan.music) {
    const asset = assets.get(plan.music.assetId)!;
    const sourceDuration = facts[asset.id]?.durationSeconds ?? asset.sourceDurationSeconds ?? T;
    if (sourceDuration + 0.05 < T) warnings.push("trilha mais curta que o vídeo: termina antes do fim");
    inputs.push("-i", asset.fileName!);
    const m = plan.music;
    const end = Math.min(T, sourceDuration);
    filters.push(`[${nextInput}:a]atrim=0:${n(end, 3)},asetpts=N/SR/TB,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${n(m.gainDb, 1)}dB${m.fadeInSeconds > 0 ? `,afade=t=in:st=0:d=${n(m.fadeInSeconds)}` : ""}${m.fadeOutSeconds > 0 ? `,afade=t=out:st=${n(Math.max(0, end - m.fadeOutSeconds), 3)}:d=${n(m.fadeOutSeconds)}` : ""}[mus]`);
    musicBus = "[mus]";
    nextInput += 1;
    if (speechBus && m.duckUnderSpeech) {
      filters.push(`${speechBus}asplit=2[spk][side]`);
      filters.push(`[mus][side]sidechaincompress=threshold=0.012:ratio=10:attack=15:release=450:makeup=1[musd]`);
      speechBus = "[spk]";
      musicBus = "[musd]";
    }
  }
  const audioBuses = [speechBus, musicBus].filter((bus): bus is string => Boolean(bus));
  const hasAudio = audioBuses.length > 0;
  if (hasAudio) {
    const mixed = audioBuses.length === 1 ? audioBuses[0]! : "[amixed]";
    if (audioBuses.length > 1) filters.push(`${audioBuses.join("")}amix=inputs=${audioBuses.length}:normalize=0:duration=longest[amixed]`);
    filters.push(`${mixed}apad,atrim=0:${n(T, 3)},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`);
  }

  const finalArgs = [
    "-hide_banner",
    "-y",
    "-filter_complex_threads",
    threads,
    ...limitInputs(inputs),
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    ...(hasAudio ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : ["-an"]),
    "-threads",
    threads,
    "-c:v",
    "libx264",
    "-preset",
    options.preset,
    "-crf",
    String(options.crf),
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-maxrate",
    plan.width * plan.height > 1_500_000 ? "12M" : "8M",
    "-bufsize",
    "24M",
    "-r",
    String(fps),
    "-frames:v",
    String(totalFrames),
    "-movflags",
    "+faststart",
    output,
  ];
  steps.push({ kind: "final", id: "final", output, args: finalArgs, frames: totalFrames, timeoutMs: Math.max(120_000, Math.round(T * 40_000)) });

  return { steps, output, totalFrames, hasAudio, warnings };
}
