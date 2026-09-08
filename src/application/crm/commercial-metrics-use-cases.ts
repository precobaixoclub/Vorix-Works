import type { CommercialMetricsFilter, CommercialMetricsReport, CommercialMetricsRepositoryPort } from "../ports/commercial-metrics-repository.port.js";

export type CommercialMetricsUseCaseDeps = {
  commercialMetricsRepository: CommercialMetricsRepositoryPort;
};

export async function getCommercialMetrics(deps: CommercialMetricsUseCaseDeps, filter: CommercialMetricsFilter): Promise<CommercialMetricsReport> {
  return deps.commercialMetricsRepository.getMetrics(filter);
}
