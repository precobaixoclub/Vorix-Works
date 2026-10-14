import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TranscriptionEnginePort } from "../../application/meetings/meeting-processing.js";
import { MeetingJobError } from "../../application/meetings/meeting-processing.js";
import type { TranscriptionResult } from "../../domain/meetings/meeting.model.js";

export type FasterWhisperConfig = {
  /** Python do ambiente com faster-whisper (ver `scripts/meetings/requirements.txt`). */
  pythonPath: string;
  scriptPath: string;
  model: string;
  computeType: string;
  /** Threads de CPU do CTranslate2 (0 = automático). */
  cpuThreads: number;
  beamSize: number;
  /** Diretório de cache dos modelos (download na primeira execução). */
  modelCacheDir?: string;
};

type ScriptOutput = {
  language: string;
  duration_seconds: number;
  model: string;
  segments: { start: number; end: number; text: string; avg_logprob?: number; no_speech_prob?: number }[];
  metrics: Record<string, number | string>;
};

/**
 * Motor de transcrição: faster-whisper num PROCESSO SEPARADO (Python), nunca dentro da API nem do
 * processo Node do worker. Um travamento/estouro de memória do modelo derruba só aquele processo
 * filho (com timeout), e o job volta para a fila.
 */
export class FasterWhisperTranscriptionEngine implements TranscriptionEnginePort {
  constructor(private readonly config: FasterWhisperConfig) {}

  async transcribe(input: { wavPath: string; language?: string; timeoutMs: number }): Promise<TranscriptionResult> {
    const outputPath = join(dirname(input.wavPath), "transcript.json");
    const args = [
      this.config.scriptPath,
      "--audio", input.wavPath,
      "--output", outputPath,
      "--model", this.config.model,
      "--compute-type", this.config.computeType,
      "--threads", String(this.config.cpuThreads),
      "--beam-size", String(this.config.beamSize),
      ...(input.language ? ["--language", input.language] : []),
      ...(this.config.modelCacheDir ? ["--cache-dir", this.config.modelCacheDir] : []),
    ];
    const started = Date.now();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.config.pythonPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-4000);
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), input.timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new MeetingJobError(`Motor de transcrição indisponível: ${error.message}`, true));
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        const tail = stderr.trim().split("\n").slice(-4).join(" ");
        reject(new MeetingJobError(signal === "SIGKILL" ? "A transcrição passou do tempo limite." : `Falha no motor de transcrição: ${tail || `código ${code}`}`, true));
      });
    });
    const output = JSON.parse(await readFile(outputPath, "utf8")) as ScriptOutput;
    return {
      language: output.language,
      engine: "faster-whisper",
      model: output.model,
      durationSeconds: output.duration_seconds,
      processingMs: Date.now() - started,
      segments: output.segments
        .filter((segment) => segment.text.trim().length > 0)
        .map((segment) => ({
          startMs: Math.round(segment.start * 1000),
          endMs: Math.round(segment.end * 1000),
          text: segment.text.trim(),
          // Confiança = probabilidade média por token (exp do log-prob médio) — aproximação útil para
          // destacar trechos duvidosos; o Whisper não entrega uma confiança calibrada.
          ...(typeof segment.avg_logprob === "number" ? { confidence: Math.max(0, Math.min(1, Number(Math.exp(segment.avg_logprob).toFixed(4)))) } : {}),
        })),
      metrics: output.metrics,
    };
  }
}
