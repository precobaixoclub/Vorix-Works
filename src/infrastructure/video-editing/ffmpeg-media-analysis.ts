/**
 * Análise de mídia com o FFmpeg já empacotado no projeto (`resolveFfmpegBinaryPath`).
 * Usado como ferramenta AUXILIAR do motor de vídeo: medir entradas, preparar áudio, gerar o
 * portador de texto transparente e verificar o MP4 final. A edição em si é do DaVinci.
 *
 * Mesmo padrão de segurança do renderizador existente: `spawn` com `shell: false`, argumentos em
 * array, binário resolvido internamente — nunca vindo de variável de ambiente ou do usuário.
 */

import { spawn } from "node:child_process";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";

export type CaptureResult = { exitCode: number | null; stderr: string; durationMs: number };

const MAX_STDERR = 4 * 1024 * 1024;

export type RunFfmpegCaptureOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Pasta de trabalho (os caminhos dos argumentos ficam relativos a ela). */
  cwd?: string;
  /** Recebe o número do último quadro processado (progresso real). */
  onFrame?: (frame: number) => void;
  /** Mantém o cabeçalho (versão do FFmpeg) no stderr. */
  banner?: boolean;
};

export function runFfmpegCapture(args: string[], options: RunFfmpegCaptureOptions = {}): Promise<CaptureResult> {
  const binary = resolveFfmpegBinaryPath();
  const timeoutMs = options.timeoutMs ?? 120_000;
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(binary, [...(options.banner ? [] : ["-hide_banner"]), "-nostdin", ...args], { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], cwd: options.cwd });
    let stderr = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`FFmpeg excedeu ${Math.round(timeoutMs / 1000)}s.`)));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("FFmpeg cancelado.")));
    };
    options.signal?.addEventListener("abort", onAbort);
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stderr.length < MAX_STDERR) stderr += text;
      if (options.onFrame) {
        const matches = text.match(/frame=\s*(\d+)/g);
        const last = matches?.[matches.length - 1];
        if (last) options.onFrame(Number(last.replace(/\D/g, "")));
      }
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (exitCode) => finish(() => resolve({ exitCode, stderr, durationMs: Date.now() - startedAt })));
  });
}

export type MediaProbe = {
  durationSeconds: number | null;
  video?: { codec: string; width: number; height: number; fps: number | null; hasAlpha: boolean };
  audio?: { codec: string; sampleRate: number | null; channels: string };
  container: string | null;
};

/** Lê o cabeçalho (`ffmpeg -i`). O FFmpeg sai com código 1 por não haver saída — esperado. */
export async function probeMedia(path: string): Promise<MediaProbe> {
  const { stderr } = await runFfmpegCapture(["-i", path], { timeoutMs: 30_000 });
  return parseProbe(stderr);
}

export function parseProbe(stderr: string): MediaProbe {
  const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const durationSeconds = durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]) : null;
  const container = /Input #0,\s*([^,]+)/.exec(stderr)?.[1]?.trim() ?? null;
  const probe: MediaProbe = { durationSeconds, container };
  const videoLine = stderr.split(/\r?\n/).find((line) => /Stream #\S+.*Video:/.test(line));
  if (videoLine) {
    const codec = /Video:\s*([A-Za-z0-9_]+)/.exec(videoLine)?.[1] ?? "?";
    const size = /,\s*(\d{2,5})x(\d{2,5})[\s,\[]/.exec(videoLine);
    const fps = /([\d.]+)\s*fps/.exec(videoLine)?.[1] ?? /([\d.]+)\s*tbr/.exec(videoLine)?.[1];
    probe.video = { codec, width: size ? Number(size[1]) : 0, height: size ? Number(size[2]) : 0, fps: fps ? Number(fps) : null, hasAlpha: /rgba|yuva|argb|bgra|ya8|ya16|pal8/.test(videoLine) };
  }
  const audioLine = stderr.split(/\r?\n/).find((line) => /Stream #\S+.*Audio:/.test(line));
  if (audioLine) {
    const codec = /Audio:\s*([A-Za-z0-9_]+)/.exec(audioLine)?.[1] ?? "?";
    const rate = /(\d+)\s*Hz/.exec(audioLine)?.[1];
    const channels = /Hz,\s*([^,]+)/.exec(audioLine)?.[1]?.trim() ?? "?";
    probe.audio = { codec, sampleRate: rate ? Number(rate) : null, channels };
  }
  return probe;
}

export type VideoAnalysis = {
  decodeErrors: string[];
  blackSegments: { start: number; end: number }[];
  silenceSegments: { start: number; end: number }[];
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  analysisMs: number;
};

/** Decodifica o arquivo inteiro: erros de decodificação, trechos pretos, silêncio e volume. */
export async function analyzeVideo(path: string, options: { hasAudio: boolean; timeoutMs?: number; signal?: AbortSignal }): Promise<VideoAnalysis> {
  const args = ["-v", "info", "-i", path, "-vf", "blackdetect=d=0.2:pix_th=0.08:pic_th=0.97"];
  if (options.hasAudio) args.push("-af", "volumedetect,silencedetect=n=-50dB:d=1.5");
  else args.push("-an");
  args.push("-f", "null", "-");
  const result = await runFfmpegCapture(args, { timeoutMs: options.timeoutMs ?? 300_000, signal: options.signal });
  return parseAnalysis(result.stderr, result.durationMs);
}

export function parseAnalysis(stderr: string, analysisMs = 0): VideoAnalysis {
  const lines = stderr.split(/\r?\n/);
  const decodeErrors = lines.filter((line) => /(error while decoding|corrupt|Invalid data found|non-existing PPS|missing picture)/i.test(line)).slice(0, 20);
  const blackSegments = [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const silenceSegments: { start: number; end: number }[] = [];
  let pendingStart: number | null = null;
  for (const line of lines) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) pendingStart = Math.max(0, Number(start[1]));
    const end = /silence_end:\s*([\d.]+)/.exec(line);
    if (end && pendingStart !== null) {
      silenceSegments.push({ start: pendingStart, end: Number(end[1]) });
      pendingStart = null;
    }
  }
  if (pendingStart !== null) silenceSegments.push({ start: pendingStart, end: Number.POSITIVE_INFINITY });
  const mean = /mean_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr)?.[1];
  const max = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr)?.[1];
  const toDb = (value: string | undefined) => (value === undefined ? null : value === "-inf" ? -Infinity : Number(value));
  return { decodeErrors, blackSegments, silenceSegments, meanVolumeDb: toDb(mean), maxVolumeDb: toDb(max), analysisMs };
}

/** Folha de contato (um quadro a cada `everySeconds`) para revisão visual humana/IA. */
export async function renderContactSheet(input: string, output: string, options: { everySeconds: number; columns: number; tileWidth: number; maxTiles?: number }): Promise<void> {
  const rows = Math.max(1, Math.ceil((options.maxTiles ?? 12) / options.columns));
  const filter = `fps=1/${options.everySeconds},scale=${options.tileWidth}:-2,tile=${options.columns}x${rows}:padding=6:margin=6:color=0x111111`;
  const result = await runFfmpegCapture(["-y", "-i", input, "-vf", filter, "-frames:v", "1", output], { timeoutMs: 120_000 });
  if (result.exitCode !== 0) throw new Error(`Falha ao gerar folha de contato: ${result.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")}`);
}

/** PNG transparente na resolução do quadro — o "portador" da camada de textos no DaVinci. */
export async function writeTransparentPng(output: string, width: number, height: number): Promise<void> {
  const result = await runFfmpegCapture(["-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${width}x${height},format=rgba`, "-frames:v", "1", output], { timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error("Falha ao gerar o portador de texto transparente.");
}

export type MusicPrep = {
  input: string;
  output: string;
  durationSeconds: number;
  gainDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  duckWindows: { startSeconds: number; endSeconds: number }[];
  duckDb: number;
};

/**
 * Prepara a trilha: corte na duração do vídeo, ganho, fade in/out e ducking sob a fala. Feito
 * aqui porque a API de scripting do DaVinci não expõe ganho nem automação do Fairlight.
 */
export async function prepareMusic(prep: MusicPrep): Promise<void> {
  const filters = [`atrim=0:${prep.durationSeconds.toFixed(3)}`, "asetpts=N/SR/TB", `volume=${prep.gainDb.toFixed(1)}dB`];
  for (const window of prep.duckWindows) {
    filters.push(`volume=-${prep.duckDb}dB:enable='between(t,${window.startSeconds.toFixed(3)},${window.endSeconds.toFixed(3)})'`);
  }
  if (prep.fadeInSeconds > 0) filters.push(`afade=t=in:st=0:d=${prep.fadeInSeconds.toFixed(2)}`);
  if (prep.fadeOutSeconds > 0) filters.push(`afade=t=out:st=${Math.max(0, prep.durationSeconds - prep.fadeOutSeconds).toFixed(3)}:d=${prep.fadeOutSeconds.toFixed(2)}`);
  const result = await runFfmpegCapture(["-y", "-i", prep.input, "-vn", "-af", filters.join(","), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", prep.output], { timeoutMs: 120_000 });
  if (result.exitCode !== 0) throw new Error(`Falha ao preparar a trilha: ${result.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")}`);
}
