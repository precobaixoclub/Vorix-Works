import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TranscriptionEnginePort } from "../../application/meetings/meeting-processing.js";
import { MeetingJobError } from "../../application/meetings/meeting-processing.js";
import type { TranscriptionResult, TranscriptionSegmentInput } from "../../domain/meetings/meeting.model.js";

export type OpenAiTranscriptionConfig = {
  /** Chave da OpenAI cadastrada no painel (cofre) ou no ambiente; lida a cada transcrição. */
  getApiKey: () => Promise<string | undefined>;
  ffmpegPath: string;
  apiBaseUrl?: string;
  /** `whisper-1` devolve segmentos com tempo (`verbose_json`), base do player e dos destaques. */
  model?: string;
  /** Duração de cada parte enviada (s). 10 min em MP3 mono 32 kbit/s ≈ 2,4 MB, longe do limite de 25 MB. */
  chunkSeconds?: number;
  fetchImpl?: typeof fetch;
};

type VerboseTranscription = {
  language?: string;
  duration?: number;
  segments?: { start: number; end: number; text: string; avg_logprob?: number }[];
};

/** Preço público do `whisper-1` (US$ por minuto) — só para a métrica de custo estimado. */
const USD_PER_MINUTE = 0.006;

/**
 * Transcrição pela API da OpenAI — motor OPCIONAL (OPENAI_OPTIONAL), usado só quando o admin o escolhe
 * no painel, pois gera custo externo por minuto. O servidor só corta o áudio em partes e envia.
 */
export class OpenAiTranscriptionEngine implements TranscriptionEnginePort {
  constructor(private readonly config: OpenAiTranscriptionConfig) {}

  async transcribe(input: { wavPath: string; language?: string; timeoutMs: number }): Promise<TranscriptionResult> {
    const apiKey = (await this.config.getApiKey().catch(() => undefined))?.trim();
    // Só chega aqui com a OpenAI escolhida no painel. Sem chave, falha clara e sem repetir sozinho:
    // o admin cadastra a chave (ou volta para o motor local) e usa "Tentar novamente".
    if (!apiKey) throw new MeetingJobError("A transcrição pela OpenAI foi escolhida no painel, mas não há chave cadastrada. Cadastre a chave em Provedores de IA ou volte para o motor local.", false);
    const started = Date.now();
    const deadline = started + input.timeoutMs;
    const model = this.config.model ?? "whisper-1";
    const chunkSeconds = this.config.chunkSeconds ?? 600;
    const chunkDir = join(dirname(input.wavPath), "openai-chunks");
    await mkdir(chunkDir, { recursive: true });
    try {
      await this.split(input.wavPath, chunkDir, chunkSeconds, Math.max(1_000, deadline - Date.now()));
      const chunks = (await readdir(chunkDir)).filter((name) => name.endsWith(".mp3")).sort();
      if (!chunks.length) throw new MeetingJobError("A gravação não tem áudio para transcrever.", false);

      const segments: TranscriptionSegmentInput[] = [];
      let offsetSeconds = 0;
      let language = input.language ?? "";
      for (const chunk of chunks) {
        const result = await this.request(join(chunkDir, chunk), { apiKey, model, ...(input.language ? { language: input.language } : {}), deadline });
        language ||= normalizeLanguage(result.language);
        for (const segment of result.segments ?? []) {
          const text = segment.text.trim();
          if (!text) continue;
          segments.push({
            startMs: Math.round((offsetSeconds + segment.start) * 1000),
            endMs: Math.round((offsetSeconds + segment.end) * 1000),
            text,
            // Mesma aproximação do motor local: exp do log-prob médio (não é confiança calibrada).
            ...(typeof segment.avg_logprob === "number" ? { confidence: Math.max(0, Math.min(1, Number(Math.exp(segment.avg_logprob).toFixed(4)))) } : {}),
          });
        }
        offsetSeconds += result.duration ?? chunkSeconds;
      }
      return {
        language: language || "pt",
        engine: "openai",
        model,
        durationSeconds: offsetSeconds,
        processingMs: Date.now() - started,
        segments,
        metrics: { chunks: chunks.length, audio_seconds: Math.round(offsetSeconds), estimated_cost_usd: Number(((offsetSeconds / 60) * USD_PER_MINUTE).toFixed(4)) },
      };
    } finally {
      await rm(chunkDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private split(wavPath: string, chunkDir: string, chunkSeconds: number, timeoutMs: number): Promise<void> {
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", wavPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", "-f", "segment", "-segment_time", String(chunkSeconds), "-reset_timestamps", "1", join(chunkDir, "part-%04d.mp3")];
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 4000) stderr += chunk.toString("utf8"); });
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("error", (error) => { clearTimeout(timer); reject(new MeetingJobError(`ffmpeg indisponível: ${error.message}`, true)); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        reject(new MeetingJobError(`Não foi possível preparar o áudio para transcrição: ${stderr.trim().split("\n").slice(-2).join(" ") || `código ${code ?? signal}`}`, signal === "SIGKILL"));
      });
    });
  }

  private async request(filePath: string, input: { apiKey: string; model: string; language?: string; deadline: number }): Promise<VerboseTranscription> {
    const remaining = input.deadline - Date.now();
    if (remaining <= 0) throw new MeetingJobError("A transcrição passou do tempo limite.", true);
    const form = new FormData();
    form.append("file", new Blob([await readFile(filePath)], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", input.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (input.language) form.append("language", input.language);
    let response: Response;
    try {
      response = await (this.config.fetchImpl ?? fetch)(`${(this.config.apiBaseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${input.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(Math.min(remaining, 10 * 60_000)),
      });
    } catch (error) {
      throw new MeetingJobError(`Falha de conexão com a transcrição da OpenAI: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      // 401/403: chave errada ou sem acesso — repetir não resolve até alguém trocar a chave.
      if (response.status === 401 || response.status === 403) throw new MeetingJobError("A chave da OpenAI foi recusada na transcrição. Verifique a chave no painel administrativo.", false);
      throw new MeetingJobError(`A transcrição da OpenAI falhou (HTTP ${response.status}): ${detail}`, response.status === 429 || response.status >= 500);
    }
    return await response.json() as VerboseTranscription;
  }
}

/** A API devolve o idioma por extenso ("portuguese"); o restante do sistema usa o código ("pt"). */
function normalizeLanguage(language?: string): string {
  const value = (language ?? "").trim().toLowerCase();
  const names: Record<string, string> = { portuguese: "pt", english: "en", spanish: "es", french: "fr", german: "de", italian: "it" };
  return names[value] ?? (/^[a-z]{2}$/.test(value) ? value : "");
}
