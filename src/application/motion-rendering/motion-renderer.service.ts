// MotionRendererService — implementação concreta da fachada `MotionRenderer`
// (`application/ports/motion-render-provider.port.ts`). Orquestra Motion Render Pipeline →
// Motion Variant Generator → MotionRenderProvider (injetado) → Motion Render Validator → Motion
// Exporter para ir de um Motion Plan já pronto a N MP4s reais.
//
// Nunca conhece Remotion, FFmpeg ou qualquer motor de renderização — só fala com a interface
// `MotionRenderProvider` e com uma função de extração de thumbnail injetada (I/O real vive em
// `infrastructure/motion-rendering/`). Isso é o que permite testar esta classe inteira com um
// provider e um extrator de thumbnail falsos, sem nenhuma renderização real.

import { join } from "node:path";
import type {
  MotionRenderer,
  MotionRenderError,
  MotionRenderJob,
  MotionRenderOptions,
  MotionRenderOutcome,
  MotionRenderProgress,
  MotionRenderProvider,
  MotionRenderResult,
  MotionVariantId,
} from "../ports/motion-render-provider.port.js";
import { buildRenderInstructions } from "../../shared/utils/motion-rendering/motion-render-pipeline.js";
import { generateMotionRenderVariants } from "../../shared/utils/motion-rendering/motion-variant-generator.js";
import { validateMotionRenderOutput, validateMotionRenderRequest } from "../../shared/utils/motion-rendering/motion-render-validator.js";
import { exportMotionRenderResult, type ThumbnailDescriptor } from "../../shared/utils/motion-rendering/motion-exporter.js";
import type { MotionPlan } from "../../shared/utils/motion-design/motion-design.types.js";

export type ExtractThumbnail = (input: { mp4AbsolutePath: string; outputDirectoryAbsolutePath: string; jobId: string }) => Promise<ThumbnailDescriptor>;

export type MotionRendererServiceDependencies = {
  provider: MotionRenderProvider;
  extractThumbnail: ExtractThumbnail;
  idGenerator?: () => string;
  now?: () => Date;
};

class SequentialIdGenerator {
  private nextNumber = 1;
  create(): string {
    const id = `motion-render-job-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

export class MotionRendererService implements MotionRenderer {
  private readonly provider: MotionRenderProvider;
  private readonly extractThumbnail: ExtractThumbnail;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;

  constructor(dependencies: MotionRendererServiceDependencies) {
    this.provider = dependencies.provider;
    this.extractThumbnail = dependencies.extractThumbnail;
    const sequential = new SequentialIdGenerator();
    this.idGenerator = dependencies.idGenerator ?? (() => sequential.create());
    this.now = dependencies.now ?? (() => new Date());
  }

  async renderMotionPlan(motionPlan: MotionPlan, options: MotionRenderOptions): Promise<MotionRenderOutcome> {
    const jobs: MotionRenderJob[] = [];
    const results: MotionRenderResult[] = [];
    const errors: MotionRenderError[] = [];

    if (!motionPlan.validation.valid) {
      errors.push({
        code: "INVALID_REQUEST",
        message: `Motion Plan "${motionPlan.planId}" não está validado (Motion Validator reportou erro); a renderização não pode começar.`,
        stage: "queued",
        recoverable: true,
      });
      return { planId: motionPlan.planId, jobs, results, errors };
    }

    const baseline = buildRenderInstructions(motionPlan, { resolution: options.resolution, fps: options.fps });
    const requestValidation = validateMotionRenderRequest(baseline);
    if (!requestValidation.valid) {
      for (const issue of requestValidation.issues.filter((i) => i.severity === "error")) {
        errors.push({ code: "INVALID_REQUEST", message: issue.message, stage: "queued", recoverable: true });
      }
      return { planId: motionPlan.planId, jobs, results, errors };
    }

    const variants = generateMotionRenderVariants(baseline, { variantCount: options.variantCount });

    for (const instructions of variants) {
      const job = await this.renderOneVariant(motionPlan, instructions, options);
      jobs.push(job);
      if (job.result) results.push(job.result);
      if (job.error) errors.push(job.error);
    }

    return { planId: motionPlan.planId, jobs, results, errors };
  }

  private async renderOneVariant(
    motionPlan: MotionPlan,
    instructions: ReturnType<typeof buildRenderInstructions>,
    options: MotionRenderOptions,
  ): Promise<MotionRenderJob> {
    const jobId = this.idGenerator();
    const variantId: MotionVariantId = instructions.variantId;
    const job: MotionRenderJob = {
      jobId,
      planId: motionPlan.planId,
      variantId,
      providerId: this.provider.id,
      status: "queued",
      createdAt: this.timestamp(),
      progress: [],
    };

    const outputAbsolutePath = join(options.outputDirectoryAbsolutePath, `motion-${motionPlan.planId}-${variantId}.mp4`);

    job.status = "rendering";
    job.startedAt = this.timestamp();

    try {
      const providerOutput = await this.provider.render(
        { jobId, instructions, outputAbsolutePath },
        (progress: MotionRenderProgress) => job.progress.push(progress),
      );

      const outputValidation = validateMotionRenderOutput(instructions, providerOutput);
      if (!outputValidation.valid) {
        const message = outputValidation.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ");
        job.status = "failed";
        job.finishedAt = this.timestamp();
        job.error = { code: "RESULT_INVALID", message, stage: "exporting", recoverable: true };
        return job;
      }

      job.status = "exporting";
      const thumbnail = await this.extractThumbnail({
        mp4AbsolutePath: providerOutput.absolutePath,
        outputDirectoryAbsolutePath: options.outputDirectoryAbsolutePath,
        jobId,
      });

      const result = exportMotionRenderResult({
        job: { jobId, planId: motionPlan.planId, variantId, providerId: this.provider.id },
        instructions,
        providerOutput,
        thumbnail,
        now: this.now,
      });

      job.status = "completed";
      job.finishedAt = this.timestamp();
      job.result = result;
      return job;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao renderizar a variante.";
      job.status = "failed";
      job.finishedAt = this.timestamp();
      job.error = { code: "RENDER_FAILED", message, stage: "rendering", recoverable: true, cause: error instanceof Error ? error.stack : undefined };
      return job;
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export function createMotionRendererService(dependencies: MotionRendererServiceDependencies): MotionRendererService {
  return new MotionRendererService(dependencies);
}
