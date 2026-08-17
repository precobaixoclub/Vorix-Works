import { apiClient } from "@/lib/api-client";
import type { ExecutionRunState } from "@/features/execution/types";
import type { ProductionChannel, ProductionFormat } from "./types";

export type GenerateFromIdeaInput = {
  workspaceId: string;
  name: string;
  objective: string;
  ideaText: string;
  format: Exclude<ProductionFormat, "video">;
  channel: ProductionChannel;
  targetAudience?: string;
  referenceImages?: string[];
};

export type GenerateFromIdeaResult = {
  executionRunId: string;
  state: ExecutionRunState;
  failureMessage?: string;
};

/** Aciona o pipeline real de geração (Sofia → Bianca → Pedro) a partir de uma ideia do tanque —
 * roda até o fim dentro da própria chamada (sem nada em background), então `state` já vem
 * resolvido — ver `src/interfaces/api/routes/v1/production.route.ts`. */
export function generateFromIdea(input: GenerateFromIdeaInput): Promise<GenerateFromIdeaResult> {
  return apiClient.post<GenerateFromIdeaResult>("/v1/production/ideas/generate", input);
}
