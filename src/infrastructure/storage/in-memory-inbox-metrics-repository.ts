import type { InboxMetricsFilter, InboxMetricsReport, InboxMetricsRepositoryPort } from "../../application/ports/inbox-metrics-repository.port.js";

/** Driver `memory` (dev/teste, sem Postgres) — devolve um relatório zerado. Nunca usado em
 * produção real (`PERSISTENCE_DRIVER=postgres` sempre lá); honesto sobre a ausência de dados em
 * vez de tentar recalcular agregações reais sobre os repositórios em memória. */
export class InMemoryInboxMetricsRepository implements InboxMetricsRepositoryPort {
  async getMetrics(_filter: InboxMetricsFilter): Promise<InboxMetricsReport> {
    return {
      receivedCount: 0,
      openCount: 0,
      pendingCount: 0,
      resolvedCount: 0,
      backlogCount: 0,
      avgFirstResponseSeconds: undefined,
      avgHandleTimeSeconds: undefined,
      aiResolvedMessageCount: 0,
      humanResolvedMessageCount: 0,
      volumeByAgent: [],
    };
  }
}
