// Motion Exporter — monta o `MotionRenderResult` final (o que a sprint pede em "Saída": MP4,
// thumbnail, metadata, duração, resolução, fps, tempo de render) a partir da saída crua do
// provider mais um thumbnail já extraído. Puro: nunca extrai o thumbnail sozinho (isso é I/O e
// vive no adapter de infraestrutura) — só monta a estrutura final a partir de peças já prontas.

import type {
  MotionRenderInstructions,
  MotionRenderJob,
  MotionRenderProviderOutput,
  MotionRenderResult,
} from "../../../application/ports/motion-render-provider.port.js";

export type ThumbnailDescriptor = {
  absolutePath: string;
  relativePath?: string;
  sizeBytes: number;
};

export type ExportMotionRenderResultOptions = {
  job: Pick<MotionRenderJob, "jobId" | "planId" | "variantId" | "providerId">;
  instructions: MotionRenderInstructions;
  providerOutput: MotionRenderProviderOutput;
  thumbnail: ThumbnailDescriptor;
  mp4RelativePath?: string;
  now?: () => Date;
};

export function exportMotionRenderResult(options: ExportMotionRenderResultOptions): MotionRenderResult {
  const now = options.now ?? (() => new Date());
  const presetUsed = options.instructions.scenes[0]?.presetId;

  if (!presetUsed) {
    throw new Error("MOTION_EXPORT_NO_SCENES: não é possível exportar um resultado sem nenhuma cena nas instruções de render.");
  }

  return {
    jobId: options.job.jobId,
    planId: options.job.planId,
    variantId: options.job.variantId,
    providerId: options.job.providerId,
    mp4: {
      absolutePath: options.providerOutput.absolutePath,
      relativePath: options.mp4RelativePath,
      sizeBytes: options.providerOutput.sizeBytes,
    },
    thumbnail: {
      absolutePath: options.thumbnail.absolutePath,
      relativePath: options.thumbnail.relativePath,
      sizeBytes: options.thumbnail.sizeBytes,
    },
    metadata: {
      presetUsed,
      format: options.instructions.format,
      totalScenes: options.instructions.scenes.length,
      generatedAt: now().toISOString(),
    },
    durationSeconds: options.providerOutput.durationSeconds,
    width: options.providerOutput.width,
    height: options.providerOutput.height,
    fps: options.providerOutput.fps,
    renderTimeMs: options.providerOutput.renderTimeMs,
    warnings: options.providerOutput.warnings,
  };
}
