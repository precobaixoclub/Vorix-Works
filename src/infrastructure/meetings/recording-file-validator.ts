import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { RecordingFileProbe, RecordingFileValidatorPort } from "../../application/meetings/meeting-recorder.js";

type FfprobeOutput = {
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
  format?: { duration?: string; size?: string };
};

export class FfprobeRecordingFileValidator implements RecordingFileValidatorPort {
  constructor(
    private readonly ffprobePath = "ffprobe",
    private readonly ffmpegPath = "ffmpeg",
    private readonly timeoutMs = 60_000,
  ) {}

  async validate(filePath: string): Promise<RecordingFileProbe> {
    const info = await run(this.ffprobePath, ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], this.timeoutMs);
    let parsed: FfprobeOutput;
    try {
      parsed = JSON.parse(info.stdout) as FfprobeOutput;
    } catch {
      throw new Error(`FILE_VALIDATION_FAILED: ffprobe retornou JSON invalido: ${info.stderr.slice(-500)}`);
    }
    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
    const durationSeconds = Number(parsed.format?.duration ?? 0);
    const bytes = (await stat(filePath)).size;
    if (!video?.codec_name || !video.width || !video.height) throw new Error("FILE_VALIDATION_FAILED: arquivo sem stream de video valido.");
    if (!audio?.codec_name) throw new Error("FILE_VALIDATION_FAILED: arquivo sem stream de audio valido.");
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || bytes <= 0) throw new Error("FILE_VALIDATION_FAILED: duracao ou tamanho invalido.");

    const volume = await run(this.ffmpegPath, ["-hide_banner", "-i", filePath, "-af", "volumedetect", "-vn", "-sn", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"], this.timeoutMs, true);
    const match = /mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i.exec(volume.stderr);
    const audioMeanVolumeDb = match && match[1]?.toLowerCase() !== "-inf" ? Number(match[1]) : undefined;
    if (audioMeanVolumeDb === undefined || !Number.isFinite(audioMeanVolumeDb) || audioMeanVolumeDb < -90) {
      throw new Error("FILE_VALIDATION_FAILED: stream de audio vazio ou silencioso.");
    }
    return { durationSeconds, bytes, videoCodec: video.codec_name, audioCodec: audio.codec_name, width: video.width, height: video.height, audioMeanVolumeDb };
  }
}

function run(command: string, args: string[], timeoutMs: number, acceptNonZero = false): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} excedeu ${timeoutMs} ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-20_000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !acceptNonZero) reject(new Error(`${command} terminou com codigo ${code}: ${stderr.slice(-1000)}`));
      else resolve({ stdout, stderr });
    });
  });
}
