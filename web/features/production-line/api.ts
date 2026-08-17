import { apiClient } from "@/lib/api-client";
import type { ExecutionRun, ExecutionRunState } from "@/features/execution/types";
import type { ProductionChannel, ProductionFormat } from "./types";

/** Motivos fechados de rejeição (requisito "registrar o motivo sempre que disponível") — espelha
 * `REJECTION_REASONS` em `src/interfaces/api/routes/v1/production.route.ts`. */
export const REJECTION_REASONS = [
  "imagem_ruim",
  "muito_texto_na_imagem",
  "copy_generica",
  "estilo_visual_nao_gostei",
  "produto_incorreto",
  "informacao_incorreta",
  "conteudo_repetitivo",
  "cta_fraco",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  imagem_ruim: "Imagem ruim",
  muito_texto_na_imagem: "Muito texto na imagem",
  copy_generica: "Copy genérica",
  estilo_visual_nao_gostei: "Não gostei do estilo",
  produto_incorreto: "Produto incorreto",
  informacao_incorreta: "Informação incorreta",
  conteudo_repetitivo: "Repetitivo",
  cta_fraco: "CTA fraco",
};

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

/** Rejeição estruturada — decide o gate como rejeitado E registra o(s) motivo(s) escolhido(s),
 * consumidos depois pela memória editorial da próxima geração deste workspace (ver
 * `getRecentRejectionSignalsForWorkspace`, real-skill-execution-handlers.ts). */
export function rejectExecutionWithFeedback(input: {
  workspaceId: string;
  runId: string;
  gateId: string;
  reasons: RejectionReason[];
  comment?: string;
}): Promise<ExecutionRun> {
  return apiClient.post<ExecutionRun>(`/v1/production/executions/${input.runId}/reject`, {
    workspaceId: input.workspaceId,
    gateId: input.gateId,
    reasons: input.reasons,
    comment: input.comment,
  });
}
