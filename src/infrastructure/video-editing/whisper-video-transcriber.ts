/**
 * Transcrição para o motor de vídeo: o MESMO script e a MESMA configuração do Vorix Meetings
 * (`scripts/meetings/faster_whisper_transcribe.py`, variáveis MEETINGS_WHISPER_*), com
 * `--word-timestamps` para a legenda destacar a palavra falada. Processo Python separado, sem shell.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Transcript } from "../../application/video-editing/transcript-tools.js";
import { runFfmpegCapture } from "./ffmpeg-media-analysis.js";

export type WhisperVideoTranscriberConfig = {
  pythonPath: string;
  scriptPath: string;
  model: string;
  computeType: string;
  threads: number;
  language?: string;
  cacheDir?: string;
  timeoutMs?: number;
};

export class WhisperVideoTranscriber {
  constructor(private readonly config: WhisperVideoTranscriberConfig) {}

  async transcribe(videoPath: string, workDir: string): Promise<Transcript> {
    const wav = join(workDir, `asr-${Date.now().toString(36)}.wav`);
    const json = `${wav}.json`;
    const extracted = await runFfmpegCapture(["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeoutMs: 300_000 });
    if (extracted.exitCode !== 0) throw new Error("não foi possível extrair o áudio do vídeo");
    const args = [this.config.scriptPath, "--audio", wav, "--output", json, "--model", this.config.model, "--compute-type", this.config.computeType, "--threads", String(this.config.threads), "--language", this.config.language ?? "pt", "--word-timestamps", ...(this.config.cacheDir ? ["--cache-dir", this.config.cacheDir] : [])];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.config.pythonPath, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("transcrição excedeu o tempo limite"));
      }, this.config.timeoutMs ?? 900_000);
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 20_000) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`transcrição falhou (código ${code}): ${stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ")}`));
      });
    });
    const output = JSON.parse(await readFile(json, "utf8")) as Transcript;
    return { language: output.language, duration_seconds: output.duration_seconds, segments: output.segments.map((segment) => ({ start: segment.start, end: segment.end, text: segment.text, ...(segment.words ? { words: segment.words.map((word) => ({ start: word.start, end: word.end, word: word.word })) } : {}) })) };
  }
}
