/**
 * Narração local (Piper/Kokoro) — chama `scripts/tts/tts_runner.py` como PROCESSO SEPARADO (sem shell,
 * argumentos fixos, JSON pelo stdin). Nenhuma API paga; o modelo fica no disco do worker.
 *
 * Configuração: `TTS_PYTHON` (intérprete com piper-tts/kokoro-onnx) e `TTS_MODEL_DIR` (modelos .onnx).
 * Sem configuração, `isLocalTtsConfigured()` é falso e o vídeo segue sem narração (comportamento atual).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TtsSegment } from "../../application/video-editing/speech-script.js";

const here = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(here, "..", "..", "..", "scripts", "tts", "tts_runner.py");

export type LocalTtsResult = {
  sampleRate: number;
  durationSeconds: number;
  segments: { text: string; start: number; end: number; words: { word: string; start: number; end: number }[] }[];
  generationMs: number;
  peakRssMb: number;
};

export function isLocalTtsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TTS_PYTHON && env.TTS_MODEL_DIR && existsSync(env.TTS_PYTHON) && existsSync(env.TTS_MODEL_DIR) && existsSync(RUNNER));
}

export function synthesizeLocal(input: { engine: "piper" | "kokoro"; voice: string; segments: readonly TtsSegment[]; output: string; leadMs?: number; timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<LocalTtsResult> {
  const env = input.env ?? process.env;
  if (!isLocalTtsConfigured(env)) return Promise.reject(new Error("Narração local não configurada (TTS_PYTHON / TTS_MODEL_DIR)."));
  const job = { engine: input.engine, voice: input.voice, modelDir: env.TTS_MODEL_DIR, output: input.output, leadMs: input.leadMs ?? 0, segments: input.segments.map((s) => ({ text: s.text, speed: s.speed, expressiveness: s.expressiveness, pauseAfterMs: s.pauseAfterMs, ...("sentencePause" in s ? { sentencePause: (s as { sentencePause?: number }).sentencePause, clausePause: (s as { clausePause?: number }).clausePause } : {}) })) };
  return new Promise((resolvePromise, reject) => {
    const child = spawn(env.TTS_PYTHON!, ["-I", RUNNER], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { PATH: env.PATH ?? "", SYSTEMROOT: env.SYSTEMROOT ?? "", HOME: env.HOME ?? "", OMP_NUM_THREADS: env.TTS_THREADS ?? "2" } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Narração excedeu o tempo limite.")); }, input.timeoutMs ?? 180_000);
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Narração falhou: ${Buffer.concat(err).toString("utf8").trim().split("\n").slice(-3).join(" ")}`));
      try { resolvePromise(JSON.parse(Buffer.concat(out).toString("utf8")) as LocalTtsResult); } catch (e) { reject(e); }
    });
    child.stdin.end(JSON.stringify(job));
  });
}

export const LOCAL_TTS_RUNNER = RUNNER;
export const ttsModelPath = (env: NodeJS.ProcessEnv, file: string) => join(env.TTS_MODEL_DIR ?? "", file);
