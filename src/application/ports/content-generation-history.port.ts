/**
 * Memória editorial: registra peças que passaram no quality gate (Lucas) para que a próxima
 * geração do mesmo workspace evite repetir headline/CTA/conceito visual recentes. Só peças
 * aprovadas entram aqui — nunca ensinamos o sistema a repetir algo que já foi reprovado (ver
 * `QualityGateExecutionTaskHandler`, real-skill-execution-handlers.ts).
 */
export type ContentGenerationHistoryEntry = {
  tenantId: string;
  workspaceId: string;
  executionRunId: string;
  marketingObjective?: string;
  headline?: string;
  title?: string;
  caption?: string;
  cta?: string;
  visualConcept?: string;
  compositionSummary?: string;
  qualityScore?: number;
  reviewStatus?: string;
};

export type ContentGenerationHistoryPort = {
  recordGeneration(entry: ContentGenerationHistoryEntry): Promise<void>;
  getRecentForWorkspace(workspaceId: string, limit?: number): Promise<ContentGenerationHistoryEntry[]>;
};
