/** CRM/Comercial — Fase 7 (Resultados). Read-model só de relatório — agrega dados já existentes
 * de `deals`/`proposals`/`tasks`/`contacts`, nunca escreve nada. Todo dado aqui é EVIDÊNCIA real
 * (nunca uma atribuição inventada) — `revenueByOrigin` usa `contacts.origin`, o único sinal de
 * atribuição de marketing que de fato existe hoje no CRM (auditoria, seção 22).
 */

export type CommercialMetricsFilter = {
  tenantId: string;
  workspaceId: string;
  pipelineId?: string;
  ownerUserId?: string;
  teamId?: string;
  origin?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type StageAging = {
  stageId: string;
  stageName: string;
  openCount: number;
  avgDaysInStage: number;
};

export type LossReasonBreakdown = {
  reason: string;
  count: number;
};

export type OriginRevenue = {
  origin: string;
  wonCount: number;
  wonValueCents: number;
};

export type CommercialMetricsReport = {
  dealsCreatedCount: number;
  openPipelineValueCents: number;
  wonCount: number;
  wonValueCents: number;
  lostCount: number;
  /** `undefined` quando não há nenhum negócio ganho OU perdido no período (denominador zero —
   * nunca `0` nesse caso, que sugeriria "0% de conversão" quando na verdade não há dado). */
  conversionRate?: number;
  avgTicketCents?: number;
  avgCycleDays?: number;
  proposalsSentCount: number;
  proposalsAcceptedCount: number;
  proposalAcceptRate?: number;
  dealsWithoutNextActionCount: number;
  stageAging: readonly StageAging[];
  lossReasons: readonly LossReasonBreakdown[];
  revenueByOrigin: readonly OriginRevenue[];
};

export type CommercialMetricsRepositoryPort = {
  getMetrics(filter: CommercialMetricsFilter): Promise<CommercialMetricsReport>;
};
