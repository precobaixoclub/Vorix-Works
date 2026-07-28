import { spawn } from "node:child_process";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";

/**
 * Detecção de mudança de cena (seção 4) via filtro nativo do FFmpeg (`select='gt(scene,T)'` +
 * `showinfo`), lendo `pts_time:` do stderr — mesma técnica de instrumentação via stderr já usada
 * em `readVideoMetadata`. Nenhuma heurística própria de comparação de frame é reimplementada.
 */

const PTS_TIME_PATTERN = /pts_time:([\d.]+)/g;

export async function detectSceneChanges(absolutePath: string, threshold = 0.3): Promise<number[]> {
  const binaryPath = resolveFfmpegBinaryPath();
  const args = ["-hide_banner", "-i", absolutePath, "-filter:v", `select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"];

  const stderr = await new Promise<string>((resolvePromise) => {
    const child = spawn(binaryPath, args, { windowsHide: true });
    let output = "";
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.on("close", () => resolvePromise(output));
    child.on("error", () => resolvePromise(output));
  });

  const timestamps: number[] = [];
  for (const match of stderr.matchAll(PTS_TIME_PATTERN)) {
    timestamps.push(Number.parseFloat(match[1]));
  }
  return timestamps;
}
