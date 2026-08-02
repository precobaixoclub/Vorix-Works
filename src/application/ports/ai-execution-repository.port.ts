import type { AiFailureCategory, AiFinishReason, AiOperation } from "./ai-gateway.port.js";

/**
 * Persistência de execuções de IA — Sprint 08 (Fase 15). NUNCA guarda prompt completo, resposta
 * completa, dado sensível, headers do provider ou chave de API — só metadados operacionais. Se um
 * dia for necessário depurar com o payload completo, isso exige uma flag explícita nova +
 * mascaramento + política de retenção curta (não implementado nesta sprint).
 */
export const AI_EXECUTION_STATUSES = ["succeeded", "failed"] as const;
export type AiExecutionStatus = (typeof AI_EXECUTION_STATUSES)[number];

export type AiExecution = {
  id: string;
  tenantId: string;
  workspaceId: string;
  userId?: string;
  conversationId?: string;
  briefingId?: string;
  operation: AiOperation;
  provider: string;
  model: string;
  promptTemplateId: string;
  promptVersion: number;
  promptHash: string;
  status: AiExecutionStatus;
  inputTokenCount: number;
  outputTokenCount: number;
  totalTokenCount: number;
  estimatedCost: number;
  currency: "USD";
  latencyMs: number;
  retryCount: number;
  fallbackUsed: boolean;
  finishReason?: AiFinishReason;
  errorCategory?: AiFailureCategory;
  traceId: string;
  correlationId: string;
  createdAt: string;
  completedAt?: string;
};

/** `id` é sempre fornecido por quem chama (o `AiGateway` usa o mesmo `traceId` que já expõe em
 * `AiResponse` — assim `BriefingFieldValue.aiExecutionId` e `AiResponse.traceId` são literalmente
 * o mesmo identificador, sem uma segunda id gerada só para o banco). */
export type CreateAiExecutionInput = Omit<AiExecution, "createdAt">;

export type ListAiExecutionsFilter = {
  tenantId: string;
  workspaceId: string;
  from?: string;
  to?: string;
  operation?: AiOperation;
};

export type AiExecutionRepositoryPort = {
  create(input: CreateAiExecutionInput): Promise<AiExecution>;
  getById(id: string): Promise<AiExecution | undefined>;
  listByWorkspace(filter: ListAiExecutionsFilter): Promise<AiExecution[]>;
};
