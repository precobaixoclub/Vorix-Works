/**
 * Sales Engine — IA comercial. Portas pequenas (mesmo racional de `commercial-copilot-generator.port`):
 * `application/sales/*` nunca importa o AI Gateway nem o domínio de Inbox diretamente.
 */

export type DealInsightsMessage = { direction: "inbound" | "outbound"; at: string; text: string };

export type DealInsightsGeneratorInput = {
  tenantId: string;
  workspaceId: string;
  dealTitle: string;
  stageName: string;
  status: string;
  facts: readonly string[];
  proposals: readonly string[];
  pendingTasks: readonly string[];
  messages: readonly DealInsightsMessage[];
};

export type GeneratedDealInsights = {
  summary: string;
  summaryEvidence: readonly string[];
  risks: readonly { title: string; evidence: string }[];
  nextActions: readonly { title: string; rationale: string; evidence: string; actionType: "call" | "message" | "meeting" | "proposal" | "follow_up" | "other" }[];
};

export type DealInsightsGeneratorResult = ({ ok: true; traceId: string } & GeneratedDealInsights) | { ok: false; category: string; message: string };

export type DealInsightsGeneratorPort = {
  generate(input: DealInsightsGeneratorInput): Promise<DealInsightsGeneratorResult>;
};

/** Mensagens recentes das conversas do contato (ponte montada na composição raiz). */
export type DealConversationReaderPort = {
  recentMessages(input: { tenantId: string; workspaceId: string; contactId: string; limit: number }): Promise<DealInsightsMessage[]>;
};
