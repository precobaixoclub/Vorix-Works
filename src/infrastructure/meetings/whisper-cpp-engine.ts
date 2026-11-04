import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { TranscriptionEnginePort } from "../../application/meetings/meeting-processing.js";
import { MeetingJobError } from "../../application/meetings/meeting-processing.js";
import type { TranscriptionResult, TranscriptionSegmentInput } from "../../domain/meetings/meeting.model.js";

export type WhisperCppConfig = {
  /** Executável `whisper-cli` (ou, em teste, o Node com `commandArgs` apontando para um script). */
  command: string;
  commandArgs?: string[];
  ffmpegPath: string;
  /** Modelo GGML quantizado (ex.: ggml-base-q5_1.bin) e onde guardá-lo. */
  model: string;
  modelDir: string;
  /** Modelo do VAD (Silero em GGML, ~1 MB); sem ele, a transcrição roda sem VAD. */
  vadModel?: string;
  threads: number;
  /** Partes do áudio (s): a memória fica constante mesmo em reuniões longas. */
  chunkSeconds?: number;
  /** Download do modelo na 1ª vez (persistido no volume do cache). */
  modelBaseUrl?: string;
  fetchImpl?: typeof fetch;
};

type CliOutput = { result?: { language?: string }; transcription?: { offsets?: { from: number; to: number }; text: string }[] };

const SAMPLE_RATE = 16_000;
const DEFAULT_MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const DEFAULT_VAD_BASE_URL = "https://huggingface.co/ggml-org/whisper-vad/resolve/main";

/**
 * Modo econômico: whisper.cpp com modelo quantizado (GGML Q5_1). Um binário em C++, sem Python nem
 * PyTorch — o menor consumo de RAM entre os motores locais. Cada parte do áudio vira um processo
 * curto; o modelo é baixado uma única vez e fica no cache persistente.
 */
export class WhisperCppTranscriptionEngine implements TranscriptionEnginePort {
  constructor(private readonly config: WhisperCppConfig) {}

  async transcribe(input: { wavPath: string; language?: string; timeoutMs: number }): Promise<TranscriptionResult> {
    const started = Date.now();
    const deadline = started + input.timeoutMs;
    const modelPath = await this.ensureFile(this.config.model, this.config.modelBaseUrl ?? DEFAULT_MODEL_BASE_URL);
    const vadPath = this.config.vadModel ? await this.ensureFile(this.config.vadModel, DEFAULT_VAD_BASE_URL).catch(() => undefined) : undefined;
    const loadedAt = Date.now();
    const chunkDir = join(dirname(input.wavPath), "whisper-cpp-parts");
    await mkdir(chunkDir, { recursive: true });
    try {
      await this.split(input.wavPath, chunkDir, this.config.chunkSeconds ?? 600, Math.max(1_000, deadline - Date.now()));
      const parts = (await readdir(chunkDir)).filter((name) => name.endsWith(".wav")).sort();
      const segments: TranscriptionSegmentInput[] = [];
      let offsetMs = 0;
      let language = input.language && input.language !== "auto" ? input.language : "";
      for (const part of parts) {
        const partPath = join(chunkDir, part);
        const output = await this.runCli(partPath, { modelPath, ...(vadPath ? { vadPath } : {}), language: language || "auto", timeoutMs: Math.max(1_000, deadline - Date.now()) });
        // Idioma detectado na 1ª parte vale para a reunião inteira.
        language ||= output.result?.language ?? "";
        for (const item of output.transcription ?? []) {
          const text = item.text.trim();
          if (!text || !item.offsets || /^\[.*\]$/.test(text)) continue;
          segments.push({ startMs: offsetMs + item.offsets.from, endMs: offsetMs + item.offsets.to, text });
        }
        offsetMs += await wavDurationMs(partPath);
      }
      const durationSeconds = offsetMs / 1000;
      const transcribeSeconds = (Date.now() - loadedAt) / 1000;
      return {
        language: language || "pt",
        engine: "whisper.cpp",
        model: this.config.model.replace(/^ggml-|\.bin$/g, ""),
        durationSeconds,
        processingMs: Date.now() - started,
        segments,
        metrics: { parts: parts.length, cpu_threads: this.config.threads, vad: vadPath ? "silero" : "off", audio_seconds: Math.round(durationSeconds), real_time_factor: durationSeconds > 0 ? Number((transcribeSeconds / durationSeconds).toFixed(4)) : 0 },
      };
    } finally {
      await rm(chunkDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Baixa o arquivo do modelo uma única vez (atômico: .part → nome final). */
  private async ensureFile(name: string, baseUrl: string): Promise<string> {
    const target = join(this.config.modelDir, name);
    if ((await stat(target).catch(() => undefined))?.size) return target;
    await mkdir(this.config.modelDir, { recursive: true });
    const response = await (this.config.fetchImpl ?? fetch)(`${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(name)}`).catch((error: unknown) => {
      throw new MeetingJobError(`Não foi possível baixar o modelo de transcrição ${name} (sem internet?): ${error instanceof Error ? error.message : String(error)}`, true);
    });
    if (!response.ok || !response.body) throw new MeetingJobError(`Download do modelo de transcrição ${name} falhou (HTTP ${response.status}).`, true);
    const partial = `${target}.${process.pid}.part`;
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
    await rename(partial, target);
    return target;
  }

  private split(wavPath: string, chunkDir: string, chunkSeconds: number, timeoutMs: number): Promise<void> {
    // PCM copiado sem recodificar: cortar é só E/S.
    return run(this.config.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", wavPath, "-f", "segment", "-segment_time", String(chunkSeconds), "-c", "copy", join(chunkDir, "part-%04d.wav")], timeoutMs, "Não foi possível preparar o áudio para transcrição");
  }

  private async runCli(partPath: string, input: { modelPath: string; vadPath?: string; language: string; timeoutMs: number }): Promise<CliOutput> {
    const prefix = partPath.replace(/\.wav$/, "");
    await run(this.config.command, [
      ...(this.config.commandArgs ?? []),
      "-m", input.modelPath, "-f", partPath, "-l", input.language, "-t", String(this.config.threads),
      "-bs", "1", "-bo", "1", "-np", "-oj", "-of", prefix,
      ...(input.vadPath ? ["--vad", "-vm", input.vadPath] : []),
    ], input.timeoutMs, "Falha no motor de transcrição (whisper.cpp)");
    return JSON.parse(await readFile(`${prefix}.json`, "utf8")) as CliOutput;
  }
}

/** Duração exata de um WAV PCM 16 kHz mono 16-bit pelo tamanho do bloco `data` do cabeçalho RIFF. */
async function wavDurationMs(path: string): Promise<number> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    let offset = 12;
    while (offset + 8 <= bytesRead) {
      const id = header.toString("ascii", offset, offset + 4);
      const size = header.readUInt32LE(offset + 4);
      if (id === "data") return Math.round((size / 2 / SAMPLE_RATE) * 1000);
      offset += 8 + size + (size % 2);
    }
    return Math.round((((await stat(path)).size - 44) / 2 / SAMPLE_RATE) * 1000);
  } finally {
    await handle.close();
  }
}

function run(command: string, args: string[], timeoutMs: number, failure: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(new MeetingJobError(`${failure}: ${error.message}`, true)); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const tail = stderr.trim().split("\n").slice(-3).join(" ");
      reject(new MeetingJobError(signal === "SIGKILL" ? "A transcrição passou do tempo limite." : `${failure}: ${tail || `código ${code}`}`, true));
    });
  });
}
