// Motion Thumbnail Extractor — extrai um frame do MP4 já renderizado para servir de thumbnail.
// Reaproveita (só importa, nunca modifica) `resolveFfmpegBinaryPath`/`runFfmpeg` de
// `infrastructure/video-rendering/`, que já implementam resolução segura do binário do FFmpeg e
// execução via `spawn` com argumentos em array (nunca shell). Não é FFmpeg-específico por
// necessidade do Motion Renderer em si — é só a forma mais simples e já auditada de pegar um
// frame de um MP4 existente; o `MotionRenderProvider` (Remotion) nunca é chamado aqui.

import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import { runFfmpeg } from "../video-rendering/ffmpeg-process-runner.js";
import type { ThumbnailDescriptor } from "../../shared/utils/motion-rendering/motion-exporter.js";

export type ExtractMotionThumbnailInput = {
  mp4AbsolutePath: string;
  outputDirectoryAbsolutePath: string;
  jobId: string;
  /** Instante do vídeo, em segundos, de onde extrair o frame. Padrão: 10% da duração (evita frame preto de fade-in). */
  atSeconds?: number;
};

export async function extractMotionThumbnail(input: ExtractMotionThumbnailInput): Promise<ThumbnailDescriptor> {
  if (!existsSync(input.mp4AbsolutePath)) {
    throw new Error(`MOTION_THUMBNAIL_SOURCE_NOT_FOUND: MP4 não encontrado em "${input.mp4AbsolutePath}".`);
  }

  const binaryPath = resolveFfmpegBinaryPath();
  const outputPath = join(dirname(input.mp4AbsolutePath) === input.outputDirectoryAbsolutePath ? input.outputDirectoryAbsolutePath : input.outputDirectoryAbsolutePath, `motion-${input.jobId}-thumb.jpg`);
  const atSeconds = input.atSeconds ?? 0.3;

  await runFfmpeg({
    binaryPath,
    args: ["-y", "-ss", String(atSeconds), "-i", input.mp4AbsolutePath, "-frames:v", "1", "-q:v", "3", outputPath],
  });

  if (!existsSync(outputPath)) {
    throw new Error(`MOTION_THUMBNAIL_WRITE_FAILED: o FFmpeg terminou sem erro, mas "${outputPath}" não foi criado.`);
  }

  return { absolutePath: outputPath, sizeBytes: statSync(outputPath).size };
}
