import type { InboxMetricsReport, InboxMetricsRepositoryPort } from "../ports/inbox-metrics-repository.port.js";

export type InboxMetricsUseCaseDeps = {
  inboxMetricsRepository: InboxMetricsRepositoryPort;
};

export async function getInboxMetrics(deps: InboxMetricsUseCaseDeps, input: { tenantId: string; workspaceId: string; dateFrom?: string; dateTo?: string }): Promise<InboxMetricsReport> {
  return deps.inboxMetricsRepository.getMetrics(input);
}
