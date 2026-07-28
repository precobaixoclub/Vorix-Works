import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CampaignFile, MediaQuality, TimelineEntry, VideoAnalysis, VideoFrame, VideoScene } from "../../domain/campaign-intelligence/campaign-intelligence.model.js";
import { readVideoMetadata } from "../visual-assets/visual-asset-metadata.js";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import { detectSceneChanges } from "./scene-detection.js";
import { recognizeText } from "./ocr.js";
import { classifyCampaignScreen } from "../../shared/utils/campaign-intelligence/campaign-screen-classification.js";

/**
 * Video Understanding (seção 4): frames relevantes (mudança de cena + amostragem regular), OCR
 * por frame, funcionalidades/telas ligadas a timestamp exato (seção 4, exemplo literal "RSVP →
 * 00:01:32"). Transcrição de narração falada (seção 4 pede "narração") é DELIBERADAMENTE deixada
 * de fora: não existe motor de ASR local neste ambiente (sem Whisper, sem API configurada) — o
 * campo `transcript` só seria preenchido a partir de legenda queimada no vídeo, nunca inventado; a
 * detecção confiável dessa distinção está fora do escopo desta sprint e é reportada como limitação.
 */

export type VideoUnderstandingOptions = {
  outputDir: string;
  frameIntervalSeconds?: number;
  sceneChangeThreshold?: number;
  maxFrames?: number;
};

async function extractFrame(absolutePath: string, timestampSeconds: number, outputPath: string): Promise<boolean> {
  const binaryPath = resolveFfmpegBinaryPath();
  return new Promise<boolean>((resolvePromise) => {
    const child = spawn(binaryPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", timestampSeconds.toFixed(3), "-i", absolutePath,
      "-frames:v", "1", outputPath,
    ], { windowsHide: true });
    child.on("close", (code) => resolvePromise(code === 0));
    child.on("error", () => resolvePromise(false));
  });
}

function estimateQuality(width: number, height: number): MediaQuality {
  const pixels = width * height;
  if (pixels >= 1_000_000) return "high";
  if (pixels >= 300_000) return "medium";
  return "low";
}

export async function analyzeVideo(file: CampaignFile, options: VideoUnderstandingOptions): Promise<VideoAnalysis> {
  const frameIntervalSeconds = options.frameIntervalSeconds ?? 5;
  const sceneChangeThreshold = options.sceneChangeThreshold ?? 0.3;
  const maxFrames = options.maxFrames ?? 40;

  const metadata = await readVideoMetadata(file.absolutePath).catch(() => ({ width: 0, height: 0, durationSeconds: 0 }));
  const sceneChangeTimestamps = await detectSceneChanges(file.absolutePath, sceneChangeThreshold).catch(() => [] as number[]);

  const scenes: VideoScene[] = [];
  const boundaries = [0, ...sceneChangeTimestamps.filter((t) => t > 0 && t < metadata.durationSeconds), metadata.durationSeconds].sort((a, b) => a - b);
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    scenes.push({ sceneIndex: index, startSeconds: boundaries[index], endSeconds: boundaries[index + 1] });
  }
  if (scenes.length === 0) scenes.push({ sceneIndex: 0, startSeconds: 0, endSeconds: metadata.durationSeconds });

  const regularTimestamps: number[] = [];
  for (let t = 0; t < metadata.durationSeconds; t += frameIntervalSeconds) regularTimestamps.push(t);
  const sampleTimestamps = Array.from(new Set([...sceneChangeTimestamps, ...regularTimestamps].map((t) => Math.max(0, Math.min(t, Math.max(metadata.durationSeconds - 0.1, 0))))))
    .sort((a, b) => a - b)
    .slice(0, maxFrames);

  await mkdir(options.outputDir, { recursive: true });

  const frames: VideoFrame[] = [];
  const timeline: TimelineEntry[] = [];
  const seenLabels = new Set<string>();

  for (const timestampSeconds of sampleTimestamps) {
    const sceneIndex = scenes.find((scene) => timestampSeconds >= scene.startSeconds && timestampSeconds <= scene.endSeconds)?.sceneIndex ?? 0;
    const framePath = join(options.outputDir, `${file.id}-frame-${timestampSeconds.toFixed(1).replace(".", "_")}s.png`);
    const extracted = await extractFrame(file.absolutePath, timestampSeconds, framePath);
    if (!extracted) continue;

    const ocrText = await recognizeText(framePath);
    frames.push({ timestampSeconds, framePath, sceneIndex, ocrText });

    const category = classifyCampaignScreen(ocrText);
    const timelineKey = `${category}`;
    if (category !== "unknown" && !seenLabels.has(timelineKey)) {
      seenLabels.add(timelineKey);
      timeline.push({ timestampSeconds, label: category, kind: "screen", confidence: ocrText.length > 20 ? 0.8 : 0.5 });
    }
  }

  return {
    fileId: file.id,
    durationSeconds: metadata.durationSeconds,
    scenes,
    frames,
    timeline: timeline.sort((a, b) => a.timestampSeconds - b.timestampSeconds),
    transcript: undefined,
    quality: estimateQuality(metadata.width, metadata.height),
  };
}
