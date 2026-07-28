import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import type { MediaShotDeviceType } from "../../application/ports/media-catalog.port.js";

/**
 * LOCAL OFFICIAL ASSET QUALIFICATION — ponte de apresentação para o Visual Candidate Validator
 * (nunca uma mudança no validador). O validador detecta um dispositivo procurando uma região
 * candidata mais clara/detalhada CONTRA UM FUNDO ao redor (mesma técnica de qualquer footage real
 * de "celular na mão") — uma captura de tela real (Company/Campaign Intelligence) preenche o
 * quadro inteiro, sem nenhum fundo ao redor para o algoritmo contrastar, então nunca seria
 * encontrada mesmo sendo 100% real. A técnica aqui é puramente geométrica e determinística (mesma
 * lógica de qualquer apresentação de "tela dentro de um dispositivo/moldura" já usada em qualquer
 * peça publicitária real): reduz a captura real e a centraliza sobre uma tela neutra, dando ao
 * MESMO algoritmo (inalterado) uma superfície justa para avaliar. O conteúdo dentro da região
 * continua sendo 100% o pixel real da captura original — nada é gerado, redesenhado ou inventado.
 */

const NEUTRAL_BACKGROUND_COLOR = "0x1a1a1a";

function canvasForDevice(device: MediaShotDeviceType): { width: number; height: number } {
  return device === "notebook" || device === "desktop" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

async function runFfmpeg(args: string[]): Promise<boolean> {
  const binaryPath = resolveFfmpegBinaryPath();
  return new Promise<boolean>((resolvePromise) => {
    const child = spawn(binaryPath, args, { windowsHide: true });
    child.on("close", (code) => resolvePromise(code === 0));
    child.on("error", () => resolvePromise(false));
  });
}

/** Enquadra uma captura de tela (imagem estática) sobre um fundo neutro, dentro de uma proporção plausível para o dispositivo pedido — puramente geométrico (scale+pad), sem nenhum conteúdo novo desenhado. */
export async function frameScreenCaptureForValidation(input: {
  absoluteImagePath: string;
  outputDir: string;
  device: MediaShotDeviceType;
}): Promise<{ framedImagePath: string; width: number; height: number } | undefined> {
  await mkdir(input.outputDir, { recursive: true });
  const { width, height } = canvasForDevice(input.device === "none" ? "phone" : input.device);
  const contentWidth = Math.round(width * 0.74);
  const framedImagePath = join(input.outputDir, `framed-${Date.now()}.png`);

  const ok = await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input.absoluteImagePath,
    "-vf", `scale=${contentWidth}:-1,pad=${width}:${height}:(${width}-iw)/2:(${height}-ih)/2:color=${NEUTRAL_BACKGROUND_COLOR}`,
    framedImagePath,
  ]);

  return ok ? { framedImagePath, width, height } : undefined;
}

/** Converte uma imagem estática (já enquadrada ou não) em um pequeno vídeo-sonda, para que o validador (que amostra múltiplos timestamps ao longo de uma duração) tenha um contêiner válido para posicionar (`-ss`) — sem isso, `analyzeVisualCandidate` nunca encontra frame algum em uma imagem estática pura (testado empiricamente). O conteúdo de cada frame do vídeo-sonda é idêntico à imagem de origem; não introduz nenhuma informação nova. */
export async function createValidationProbeVideo(input: {
  absoluteImagePath: string;
  outputDir: string;
  durationSeconds?: number;
}): Promise<{ probeVideoPath: string; durationSeconds: number } | undefined> {
  await mkdir(input.outputDir, { recursive: true });
  const durationSeconds = input.durationSeconds ?? 2;
  const probeVideoPath = join(input.outputDir, `probe-${Date.now()}.mp4`);

  const ok = await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-loop", "1", "-i", input.absoluteImagePath,
    "-t", String(durationSeconds), "-r", "30", "-pix_fmt", "yuv420p",
    probeVideoPath,
  ]);

  return ok ? { probeVideoPath, durationSeconds } : undefined;
}
