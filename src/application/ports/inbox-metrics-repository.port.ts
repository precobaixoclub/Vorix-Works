/** Operational metrics use structured attendances and responsibility cycles.
 * Message volume remains a separate measure; automated replies never become human FRT. */

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
  /** Average human FRT per responsibility cycle started in the period; absent without samples. */
  avgFirstResponseSeconds?: number;
  /** Global resolution time: closed_at - opened_at, attributed by attendance closure date. */
  avgHandleTimeSeconds?: number;
  aiResolvedMessageCount: number;
  humanResolvedMessageCount: number;
  volumeByAgent: readonly InboxAgentVolume[];
  /** Pesquisa de satisfação (1–5) respondida no período; média `undefined` sem respostas. */
  csatAverage?: number;
  csatResponses: number;
  csatRequested: number;
  csatByAgent: readonly { userId: string; average: number; responses: number }[];
  /** Encerramentos por motivo no período ("Sem motivo" quando não informado). */
  closingReasons: readonly { reason: string; count: number }[];
};

export type InboxMetricsRepositoryPort = {
  getMetrics(filter: InboxMetricsFilter): Promise<InboxMetricsReport>;
};
