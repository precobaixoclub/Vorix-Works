/**
 * Prova auditável de qual motor criativo produziu cada peça — ver `db/migrations/0060_creative_engine_runs.sql`.
 * Uma linha por execução do motor criativo (GPT ou, quando o motor legado estiver ativo para
 * rollback, legado também), guardando o `creativeContext`/`creativePlan`/prompt final de imagem
 * integralmente. Sem leitor real ainda nesta etapa da migração (a Camada de execução do motor GPT
 * que vai escrever aqui chega em uma etapa posterior) — esta porta só estabelece o contrato e a
 * persistência.
 */
export const CREATIVE_ENGINE_RUN_MODES = ["gpt", "legacy"] as const;
export type CreativeEngineRunMode = (typeof CREATIVE_ENGINE_RUN_MODES)[number];

export const CREATIVE_ENGINE_RUN_GENERATION_METHODS = ["generation", "edit", "original_asset_composition"] as const;
export type CreativeEngineRunGenerationMethod = (typeof CREATIVE_ENGINE_RUN_GENERATION_METHODS)[number];

export const CREATIVE_ENGINE_RUN_STATUSES = ["completed", "failed"] as const;
export type CreativeEngineRunStatus = (typeof CREATIVE_ENGINE_RUN_STATUSES)[number];

export type CreativeEngineRun = {
  id: string;
  tenantId: string;
  workspaceId: string;
  executionRunId: string;
  taskRunId?: string;
  engineMode: CreativeEngineRunMode;
  planningTemplate: string;
  directorModel: string;
  imageModel?: string;
  generationMethod?: CreativeEngineRunGenerationMethod;
  /** Objeto completo enviado ao GPT como diretor criativo — ver `CreativeContext` (`gpt-creative-plan.types.ts`). */
  creativeContext: unknown;
  /** Objeto completo devolvido pelo GPT — ver `CreativePlan`. */
  creativePlan?: unknown;
  finalImagePrompt?: string;
  assetsUsed: unknown[];
  compositionSteps: unknown[];
  qualityGate?: unknown;
  /** Auditoria "qualidade visual e direção de arte" (segunda auditoria) — DELIBERADAMENTE separado
   * de `qualityGate`: aquele campo é o veredito TÉCNICO pass/fail; este é a avaliação estética (12
   * dimensões + nota geral + justificativas, ver `evaluate-visual-quality-score.ts`), nunca um
   * pass/fail puro. `undefined` quando o gate técnico nunca chegou a passar (score nunca roda antes
   * disso) ou a chamada de visão falhou (best-effort). */
  visualQualityScore?: unknown;
  /** Auditoria "qualidade visual e direção de arte", ponto 9 — direção criativa escolhida na
   * exploração barata pré-plano (ver `explore-creative-directions.ts`). `undefined` quando a
   * exploração falhou/veio incompleta (best-effort). */
  chosenCreativeDirection?: unknown;
  /** Auditoria de custo urgente — breakdown de custo por etapa (director/exploração/imagem/gate
   * técnico/Visual Quality Score) + subtotal de rodadas de reparo, ver `CreativeEngineCostBreakdown`
   * (`run-gpt-creative-engine.ts`). Sempre presente quando a execução chega a gerar QUALQUER
   * chamada paga — `undefined` só em falhas anteriores a isso (nunca deveria acontecer no caminho
   * real, mas o tipo permanece opcional pra nunca quebrar uma linha histórica). */
  costBreakdown?: unknown;
  repairRounds: unknown[];
  finalImageUrl?: string;
  finalImageWidth?: number;
  finalImageHeight?: number;
  /** Nasce `false`; só vira `true` quando o run inteiro (geração + composição + quality gate) termina limpo. */
  publishable: boolean;
  estimatedCostUsd: number;
  latencyMs: number;
  status: CreativeEngineRunStatus;
  errorCode?: string;
  createdAt: string;
};

export type CreateCreativeEngineRunInput = Omit<CreativeEngineRun, "createdAt">;

export type ListCreativeEngineRunsFilter = {
  workspaceId: string;
  from?: string;
  to?: string;
  engineMode?: CreativeEngineRunMode;
};

export type CreativeEngineRunRepositoryPort = {
  create(input: CreateCreativeEngineRunInput): Promise<CreativeEngineRun>;
  getByExecutionRunId(executionRunId: string): Promise<CreativeEngineRun | undefined>;
  listByWorkspace(filter: ListCreativeEngineRunsFilter): Promise<CreativeEngineRun[]>;
};
