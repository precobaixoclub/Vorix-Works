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
  /** Migração "GPT como motor criativo único" (PR 6/9) — qual motor produziu esta peça.
   * `undefined` em linhas históricas anteriores a esta coluna (migration 0061), lido honestamente
   * como "execução anterior a esta coluna existir", nunca inferido. */
  engineMode?: "gpt" | "legacy";
  /** Liga esta linha à prova auditável completa em `creative_engine_runs` (só quando
   * `engineMode === "gpt"`). */
  creativeEngineRunId?: string;
  /** Legenda/descrição pronta para a tela de revisão — o motor legado nunca preenchia isto
   * separado de `caption`; o motor GPT usa `creative_plan.description`. */
  description?: string;
};

export type ContentGenerationHistoryPort = {
  recordGeneration(entry: ContentGenerationHistoryEntry): Promise<void>;
  getRecentForWorkspace(workspaceId: string, limit?: number): Promise<ContentGenerationHistoryEntry[]>;
};
