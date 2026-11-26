/**
 * Porta do motor de execução audiovisual. A aplicação (planejamento, jobs, UI) fala só com esta
 * interface; o adaptador real é `infrastructure/davinci-resolve/davinci-resolve-executor.ts`.
 */

import type { VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";

export type VideoEditStage = "validating" | "staging" | "connecting" | "building_timeline" | "rendering" | "verifying" | "done";

export type VideoEditProgress = { stage: VideoEditStage; percent: number; message: string };

export type VideoEditExecutionRequest = {
  /** Id do job: minúsculas, dígitos e hífen. Define a pasta isolada do job. */
  jobId: string;
  plan: VideoEditPlan;
  /** assetId → caminho absoluto JÁ autorizado para este workspace (resolvido pela aplicação). */
  mediaSources: Record<string, string>;
  /** Onde gravar o MP4 final. */
  outputPath: string;
  signal?: AbortSignal;
  onProgress?: (progress: VideoEditProgress) => void;
};

export type VideoEditExecutionResult = {
  outputPath: string;
  sizeBytes: number;
  projectName: string;
  timelineName: string;
  warnings: string[];
  timings: Record<string, number>;
  engine: { product: string; version: string; codec: string };
  operationsSent: number;
};

export type VideoEditExecutor = {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  execute(request: VideoEditExecutionRequest): Promise<VideoEditExecutionResult>;
};
