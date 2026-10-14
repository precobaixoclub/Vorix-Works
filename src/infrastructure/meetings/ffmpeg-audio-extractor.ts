import { spawn } from "node:child_process";
import type { AudioExtractorPort } from "../../application/meetings/meeting-processing.js";
import { MeetingJobError } from "../../application/meetings/meeting-processing.js";

/**
 * Extração de áudio para transcrição: qualquer formato aceito no upload (MP3, M4A, WAV, WEBM, OGG,
 * MP4, MOV) → WAV PCM 16 kHz mono, em STREAMING (o ffmpeg lê e escreve em disco; nada do arquivo
 * passa pela memória do Node). ffmpeg aqui é só conversão de mídia — nunca captura.
 */
export class FfmpegAudioExtractor implements AudioExtractorPort {
  constructor(private readonly ffmpegPath: string) {}

  extractWav16kMono(input: { sourcePath: string; targetPath: string; timeoutMs: number }): Promise<void> {
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input.sourcePath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", input.targetPath];
    return new Promise((resolve, reject) => {
      const child = spawn(this.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 4000) stderr += chunk.toString("utf8");
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), input.timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new MeetingJobError(`ffmpeg indisponível: ${error.message}`, true));
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        // Arquivo corrompido / sem trilha de áudio: repetir não resolve.
        const text = stderr.trim().split("\n").slice(-3).join(" ") || `código ${code ?? signal}`;
        reject(new MeetingJobError(`Não foi possível extrair o áudio da gravação: ${text}`, signal === "SIGKILL"));
      });
    });
  }
}
