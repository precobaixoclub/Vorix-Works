/**
 * CRM/Comercial — Fase 5 (Copiloto Comercial). Porta pequena e específica, mesmo racional de
 * `inbox-ai-responder.port.ts`: `src/application/crm/*` NUNCA importa `AiGatewayPort`/`AiRequest`/
 * prompt templates diretamente — só este contrato. A implementação real
 * (`infrastructure/ai-gateway/commercial-copilot-generator-adapter.ts`) é quem sabe como isso vira
 * um `AiRequest` de verdade.
 *
 * Qualquer falha do provider/Gateway nunca lança — sempre `CommercialCopilotGeneratorResult` com
 * `ok:false`, mesmo espírito de `InboxAiResponderResult`.
 */

export type CommercialCopilotDealInput = {
  title: string;
  stageName: string;
  isWon: boolean;
  isLost: boolean;
  valueCents: number;
  daysInStage: number;
};

export type CommercialCopilotTaskInput = {
  title: string;
  status: "pending" | "done" | "cancelled";
  overdueDays?: number;
};

export type CommercialCopilotGeneratorInput = {
  tenantId: string;
  workspaceId: string;
  contactName: string;
  origin?: string;
  tags: readonly string[];
  daysSinceLastInteraction?: number;
  deals: readonly CommercialCopilotDealInput[];
  pendingTasks: readonly CommercialCopilotTaskInput[];
};

export type GeneratedCommercialSuggestion = {
  title: string;
  rationale: string;
  evidence: string;
  confidence: number;
  suggestedAction: "follow_up_task" | "reach_out" | "review_deal_stage" | "send_proposal" | "none";
};

export type CommercialCopilotGeneratorSuccess = {
  ok: true;
  suggestions: readonly GeneratedCommercialSuggestion[];
  traceId: string;
};

export type CommercialCopilotGeneratorFailure = {
  ok: false;
  /** Categoria segura (nunca o erro bruto do provider) — `string` solto de propósito: `crm` nunca
   * importa o tipo do AI Gateway. */
  category: string;
  message: string;
};

export type CommercialCopilotGeneratorResult = CommercialCopilotGeneratorSuccess | CommercialCopilotGeneratorFailure;

export type CommercialCopilotGeneratorPort = {
  generateSuggestions(input: CommercialCopilotGeneratorInput): Promise<CommercialCopilotGeneratorResult>;
};
