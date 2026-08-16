import { apiClient } from "@/lib/api-client";
import type { ProductionChannel, ProductionFormat } from "./types";

export type GenerateFromIdeaInput = {
  workspaceId: string;
  name: string;
  objective: string;
  ideaText: string;
  format: Exclude<ProductionFormat, "video">;
  channel: ProductionChannel;
  targetAudience?: string;
};

/** Aciona o pipeline real de geração (Sofia → Bianca → Pedro) a partir de uma ideia do tanque —
 * ver `src/interfaces/api/routes/v1/production.route.ts`. Devolve o id da execução para
 * acompanhar em `/workspaces/[workspaceId]/execution/[runId]`, já existente. */
export function generateFromIdea(input: GenerateFromIdeaInput): Promise<{ executionRunId: string }> {
  return apiClient.post<{ executionRunId: string }>("/v1/production/ideas/generate", input);
}
