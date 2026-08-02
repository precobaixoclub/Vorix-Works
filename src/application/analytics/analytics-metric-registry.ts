import { ANALYTICS_DIMENSIONS, type AnalyticsDimensionId, type AnalyticsMetricDefinition } from "../../domain/analytics/analytics.model.js";

const ALL_DIMENSIONS: readonly AnalyticsDimensionId[] = ANALYTICS_DIMENSIONS;

export const ANALYTICS_METRIC_DEFINITIONS: readonly AnalyticsMetricDefinition[] = [
  metric("publication_requested_total", "Publicacoes solicitadas", "Total de publicacoes solicitadas.", "publication"),
  metric("publication_completed_total", "Publicacoes concluidas", "Total de publicacoes concluidas.", "publication"),
  metric("publication_failed_total", "Publicacoes com falha", "Total de publicacoes com falha.", "publication"),
  metric("publication_unknown_outcome_total", "Outcome desconhecido", "Publicacoes com resultado desconhecido.", "publication"),
  metric("publication_reconciled_total", "Publicacoes reconciliadas", "Total de reconciliacoes concluidas.", "publication"),
  metric("publication_cancelled_total", "Publicacoes canceladas", "Total de publicacoes canceladas.", "publication"),
  metric("receipt_created_total", "Receipts criados", "Total de receipts criados.", "publication"),
  metric("receipt_verified_total", "Receipts verificados", "Total de receipts verificados.", "publication"),
  rateMetric("publication_success_rate", "Taxa de sucesso", "Publicacoes concluidas sobre solicitadas.", "publication"),
  rateMetric("publication_failure_rate", "Taxa de falha", "Publicacoes com falha sobre solicitadas.", "publication"),
  rateMetric("publication_reconciliation_rate", "Taxa de reconciliacao", "Reconciliacoes sobre outcomes desconhecidos.", "publication"),
  msMetric("publication_dispatch_latency_ms", "Latencia de dispatch", "Tempo ate dispatch de publicacao.", "publication", "average"),
  msMetric("publication_completion_latency_ms", "Latencia de publicacao", "Tempo ate conclusao de publicacao.", "publication", "average"),
  msMetric("publication_queue_wait_ms", "Espera de fila", "Tempo aguardando na fila de publicacao.", "publication", "average"),
  metric("publication_retry_total", "Retries de publicacao", "Total de retries de publicacao.", "operational"),
  metric("publication_dead_letter_total", "Dead letters de publicacao", "Total de dead letters de publicacao.", "operational"),
  metric("provider_error_total", "Erros de provider", "Total de erros de provider.", "provider"),
  metric("provider_rate_limit_total", "Rate limits", "Total de rate limits.", "provider"),
  metric("credential_failure_total", "Falhas de credencial", "Total de falhas de credencial.", "credential"),
  metric("governance_denial_total", "Negacoes de governanca", "Total de negacoes de governanca.", "governance"),

  metric("schedules_created_total", "Schedules criados", "Total de agendas criadas.", "scheduling"),
  metric("schedules_active_total", "Schedules ativos", "Total derivado de agendas ativas.", "scheduling"),
  metric("schedule_occurrences_generated_total", "Occurrences geradas", "Total de ocorrencias geradas.", "scheduling"),
  metric("schedule_occurrences_dispatched_total", "Occurrences despachadas", "Total de ocorrencias despachadas.", "scheduling"),
  metric("schedule_occurrences_completed_total", "Occurrences concluidas", "Total de ocorrencias concluidas.", "scheduling"),
  metric("schedule_occurrences_failed_total", "Occurrences com falha", "Total de ocorrencias com falha.", "scheduling"),
  metric("schedule_occurrences_missed_total", "Occurrences perdidas", "Total de ocorrencias missed.", "scheduling"),
  metric("schedule_occurrences_cancelled_total", "Occurrences canceladas", "Total de ocorrencias canceladas.", "scheduling"),
  rateMetric("schedule_occurrence_success_rate", "Taxa de sucesso do calendario", "Occurrences concluidas sobre despachadas.", "scheduling"),
  rateMetric("schedule_on_time_rate", "Taxa on-time", "Occurrences no prazo sobre despachadas.", "scheduling"),
  rateMetric("schedule_late_rate", "Taxa de atraso", "Occurrences atrasadas sobre despachadas.", "scheduling"),
  msMetric("schedule_average_delay_ms", "Atraso medio", "Atraso medio de occurrence.", "scheduling", "average"),
  metric("schedule_conflict_total", "Conflitos de agenda", "Total de conflitos de agenda.", "scheduling"),
  metric("schedule_dead_letter_total", "Dead letters de agenda", "Total de dead letters de scheduling.", "scheduling"),

  metric("execution_runs_total", "Execucoes", "Total de execucoes.", "execution"),
  metric("execution_runs_completed_total", "Execucoes concluidas", "Total de execucoes concluidas.", "execution"),
  metric("execution_runs_failed_total", "Execucoes com falha", "Total de execucoes com falha.", "execution"),
  rateMetric("execution_success_rate", "Taxa de sucesso de execution", "Execucoes concluidas sobre iniciadas.", "execution"),
  msMetric("execution_duration_ms", "Duracao de execution", "Duracao media de execution.", "execution", "average"),
  msMetric("execution_task_duration_ms", "Duracao de task", "Duracao media de tasks.", "execution", "average"),
  metric("execution_retry_total", "Retries de execution", "Total de retries em execution.", "execution"),
  currencyMetric("execution_cost_total", "Custo total", "Custo total quando fonte confiavel existir.", "execution", "sum"),
  currencyMetric("execution_cost_average", "Custo medio", "Custo medio quando fonte confiavel existir.", "execution", "average"),
  metric("execution_artifacts_total", "Artefatos", "Total de artefatos gerados.", "execution"),
  metric("execution_artifact_failure_total", "Falhas de artefato", "Total de falhas de artefato.", "execution"),

  metric("content_items_planned_total", "Conteudos planejados", "Total de itens planejados.", "editorial"),
  metric("content_items_generated_total", "Conteudos gerados", "Total de itens gerados.", "editorial"),
  metric("content_items_approved_total", "Conteudos aprovados", "Total de itens aprovados.", "editorial"),
  metric("content_items_rejected_total", "Conteudos rejeitados", "Total de itens rejeitados.", "editorial"),
  metric("content_items_published_total", "Conteudos publicados", "Total de itens publicados.", "editorial"),
  metric("content_items_scheduled_total", "Conteudos agendados", "Total de itens agendados.", "editorial"),
  metric("content_items_cancelled_total", "Conteudos cancelados", "Total de itens cancelados.", "editorial"),
  rateMetric("planning_to_publication_conversion_rate", "Conversao planejamento-publicacao", "Publicacoes sobre planejamentos.", "editorial"),
  msMetric("average_planning_to_publication_time", "Tempo planejamento-publicacao", "Tempo medio entre Planning e Publication.", "editorial", "average"),
  msMetric("average_execution_to_publication_time", "Tempo execution-publicacao", "Tempo medio entre Execution e Publication.", "editorial", "average"),
  msMetric("average_schedule_lead_time", "Lead time de agenda", "Tempo medio entre agenda e due.", "editorial", "average"),
  rateMetric("campaign_completion_rate", "Conclusao de campanha", "Taxa de conclusao por campanha.", "editorial"),
  metric("campaign_publication_volume", "Volume por campanha", "Volume de publicacoes por campanha.", "editorial"),

  metric("analytics_events_ingested_total", "Eventos ingeridos", "Total de eventos analiticos ingeridos.", "operational"),
  metric("analytics_events_rejected_total", "Eventos rejeitados", "Total de eventos analiticos rejeitados.", "operational"),
  metric("analytics_events_duplicated_total", "Eventos duplicados", "Total de eventos duplicados.", "operational"),
  metric("analytics_events_dead_lettered_total", "Dead letters analytics", "Total de eventos enviados para dead letter.", "operational"),
  msMetric("analytics_ingestion_latency_ms", "Latencia de ingestao", "Tempo entre ocorrencia e ingestao.", "operational", "average"),
  metric("analytics_query_total", "Consultas analytics", "Total de consultas analytics.", "operational"),
  msMetric("analytics_query_latency_ms", "Latencia de query", "Tempo de consulta analytics.", "operational", "average"),
  metric("analytics_query_failure_total", "Falhas de query", "Total de falhas de query.", "operational"),
  metric("analytics_snapshot_build_total", "Builds de snapshot", "Total de snapshots construidos.", "operational"),
  msMetric("analytics_snapshot_build_duration_ms", "Duracao de snapshot", "Duracao media de build de snapshot.", "operational", "average"),
  metric("analytics_snapshot_failure_total", "Falhas de snapshot", "Total de falhas de snapshot.", "operational"),
  metric("analytics_export_total", "Exports", "Total de exports.", "operational"),
  metric("analytics_export_failure_total", "Falhas de export", "Total de falhas de export.", "operational"),
  metric("analytics_data_quality_issue_total", "Issues de qualidade", "Total de issues de qualidade.", "operational"),
  metric("analytics_insight_generated_total", "Insights gerados", "Total de insights gerados.", "operational"),
  metric("analytics_alert_active_total", "Alertas ativos", "Total de alertas ativos.", "operational"),
];

export class AnalyticsMetricRegistry {
  private readonly definitions = new Map(ANALYTICS_METRIC_DEFINITIONS.map((definition) => [definition.metricId, definition]));

  list(): readonly AnalyticsMetricDefinition[] {
    return [...this.definitions.values()];
  }

  get(metricId: string): AnalyticsMetricDefinition | undefined {
    return this.definitions.get(metricId);
  }

  require(metricId: string): AnalyticsMetricDefinition {
    const definition = this.get(metricId);
    if (!definition || definition.status !== "active") throw new Error(`ANALYTICS_METRIC_UNKNOWN: metric "${metricId}" não está registrada.`);
    return definition;
  }

  assertDimension(dimension: string): asserts dimension is AnalyticsDimensionId {
    if (!(ALL_DIMENSIONS as readonly string[]).includes(dimension)) throw new Error(`ANALYTICS_DIMENSION_UNKNOWN: dimension "${dimension}" não está registrada.`);
  }
}

function metric(metricId: string, displayName: string, description: string, category: AnalyticsMetricDefinition["category"], aggregationType: AnalyticsMetricDefinition["aggregationType"] = "count"): AnalyticsMetricDefinition {
  return { metricId, displayName, description, category, unit: "count", aggregationType, supportedDimensions: ALL_DIMENSIONS, sourceType: "internal", dataType: "integer", version: 1, status: "active" };
}

function rateMetric(metricId: string, displayName: string, description: string, category: AnalyticsMetricDefinition["category"]): AnalyticsMetricDefinition {
  return { metricId, displayName, description, category, unit: "percent", aggregationType: "rate", supportedDimensions: ALL_DIMENSIONS, sourceType: "internal", dataType: "float", version: 1, status: "active" };
}

function msMetric(metricId: string, displayName: string, description: string, category: AnalyticsMetricDefinition["category"], aggregationType: AnalyticsMetricDefinition["aggregationType"]): AnalyticsMetricDefinition {
  return { metricId, displayName, description, category, unit: "ms", aggregationType, supportedDimensions: ALL_DIMENSIONS, sourceType: "internal", dataType: "float", version: 1, status: "active" };
}

function currencyMetric(metricId: string, displayName: string, description: string, category: AnalyticsMetricDefinition["category"], aggregationType: AnalyticsMetricDefinition["aggregationType"]): AnalyticsMetricDefinition {
  return { metricId, displayName, description, category, unit: "currency", aggregationType, supportedDimensions: ALL_DIMENSIONS, sourceType: "internal", dataType: "float", version: 1, status: "active" };
}
