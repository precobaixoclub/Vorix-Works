/** Módulo Conversas — Fase 7 (Resultados). Read-model só de relatório — agrega dados já existentes
 * de `inbox_conversations`/`inbox_messages`, nunca escreve nada. Port deliberadamente separado de
 * `InboxConversationRepositoryPort` (que é sobre operação do dia a dia) pra não forçar nenhuma
 * outra implementação existente a ganhar um método novo. */

export type InboxMetricsFilter = {
  tenantId: string;
  workspaceId: string;
  dateFrom?: string;
  dateTo?: string;
};

export type InboxAgentVolume = {
  userId: string;
  messageCount: number;
};

export type InboxMetricsReport = {
  receivedCount: number;
  openCount: number;
  pendingCount: number;
  resolvedCount: number;
  backlogCount: number;
  /** `undefined` quando nenhuma conversa no período teve uma resposta depois da primeira mensagem
   * inbound — nunca `0` nesse caso (0 segundos seria um dado inventado). */
  avgFirstResponseSeconds?: number;
  /** Aproximação via `updated_at` da conversa no momento em que o status virou `resolved` — o
   * schema do módulo Conversas não tem um `resolved_at` dedicado (ver auditoria da Fase 7:
   * documentar a aproximação em vez de inventar precisão que não existe). */
  avgHandleTimeSeconds?: number;
  aiResolvedMessageCount: number;
  humanResolvedMessageCount: number;
  volumeByAgent: readonly InboxAgentVolume[];
};

export type InboxMetricsRepositoryPort = {
  getMetrics(filter: InboxMetricsFilter): Promise<InboxMetricsReport>;
};
