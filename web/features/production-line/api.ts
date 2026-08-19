import { apiClient } from "@/lib/api-client";
import { getExecutionRun } from "@/features/execution/api";
import type { ExecutionRun, ExecutionRunDetail } from "@/features/execution/types";
import type { ProductionChannel, ProductionFormat } from "./types";

// Bug real achado ao vivo (Rodada 2, Fatia 3): o editor de ideias não tem um campo separado de
// "objetivo" — o texto da ideia (`ideaText`, até 2000 caracteres) era espelhado direto em
// `objective`, que a API limita a 300 (ver `GENERATE_BODY_SCHEMA`,
// `src/interfaces/api/routes/v1/production.route.ts`). Qualquer ideia com mais de 300 caracteres
// nunca conseguia gerar — a requisição sempre voltava com `VALIDATION_ERROR`. `deriveObjective`
// centraliza o corte no mesmo limite da API, usado em todo lugar que monta `objective` a partir
// do texto livre da ideia (inclusive dados antigos já salvos no navegador, de antes desta correção).
export const MAX_OBJECTIVE_LENGTH = 300;

export function deriveObjective(objective: string | undefined, ideaText: string): string {
  return (objective || ideaText).slice(0, MAX_OBJECTIVE_LENGTH);
}

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
  state: "running";
};

/**
 * Aciona o pipeline real de geração (Sofia → Bianca → Pedro) a partir de uma ideia do tanque —
 * devolve `executionRunId` na hora (Rodada 2, Fatia 3 — achado ao vivo: a versão síncrona antiga
 * segurava a conexão HTTP por minutos até o pipeline inteiro terminar, e isso se mostrou frágil
 * demais contra timeouts de rede fora do nosso controle, causando "erro de conexão" mesmo quando
 * o backend terminava normalmente). O pipeline roda em background no servidor; use
 * `waitForExecutionRunTerminal` pra acompanhar até o estado final — ver
 * `src/interfaces/api/routes/v1/production.route.ts`.
 */
export function generateFromIdea(input: GenerateFromIdeaInput): Promise<GenerateFromIdeaResult> {
  return apiClient.post<GenerateFromIdeaResult>("/v1/production/ideas/generate", input);
}

const POLL_INTERVAL_MS = 3_000;
// Bem acima do pior caso real observado (~2min por tentativa) — existe só como rede de segurança
// contra um poll infinito se algo travar de verdade no backend, nunca deveria ser atingido.
const POLL_MAX_DURATION_MS = 10 * 60 * 1_000;

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "waiting_for_approval"]);

/** Consulta `GET /execution-runs/:id` em intervalos até o estado terminar (aprovado/reprovado/
 * cancelado — `waiting_for_approval` conta como terminal aqui porque é exatamente o "passou no
 * Quality Gate automático, aguardando aprovação humana na tela de Revisão" que a Produção
 * considera sucesso). Devolve o último `ExecutionRunDetail` conhecido mesmo se estourar
 * `POLL_MAX_DURATION_MS` sem terminar — o chamador decide o que fazer com um estado ainda
 * "running" (nunca finge que terminou). */
export async function waitForExecutionRunTerminal(workspaceId: string, executionRunId: string): Promise<ExecutionRunDetail> {
  const startedAt = Date.now();
  for (;;) {
    const detail = await getExecutionRun(workspaceId, executionRunId);
    if (TERMINAL_RUN_STATES.has(detail.run.state) || Date.now() - startedAt > POLL_MAX_DURATION_MS) return detail;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export function extractExecutionRunFailure(detail: ExecutionRunDetail): { code?: string; message?: string } {
  const failedAttempt = [...detail.attempts].reverse().find((attempt) => attempt.failure);
  return { code: failedAttempt?.failure?.code, message: failedAttempt?.failure?.message };
}

// Espelha `evaluateSemanticOcclusion` em `lucas-quality-review.skill.ts` — mesmo formato exato de
// mensagem. Rodada 2, Fatia 3 (achado ao vivo): uma reprovação por rosto/olhos cobertos que o
// Repair Loop já tentou reposicionar e não resolveu tem baixa chance de ser corrigida só
// regenerando copy/estratégia do zero — o problema é a composição fotográfica, não o texto. Pular
// a regeneração automática nesse caso específico evita gastar outros ~2 minutos (e uma chamada
// paga da OpenAI) sem ganho real; nas outras causas de reprovação a regeneração automática
// continua valendo a pena.
const SEMANTIC_OCCLUSION_FACE_FAILURE_PATTERN = /Elemento "[^"]+" sobre "(face|eyes)"/;

export function isUnrecoverableSemanticOcclusionFailure(failureMessage: string | undefined): boolean {
  return typeof failureMessage === "string" && SEMANTIC_OCCLUSION_FACE_FAILURE_PATTERN.test(failureMessage);
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
