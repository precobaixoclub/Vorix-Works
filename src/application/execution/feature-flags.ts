export type ExecutionFeatureFlags = {
  realExecutionEnabled: boolean;
  realExecutionResearchEnabled: boolean;
  realPlanningEnabled: boolean;
  realCopyEnabled: boolean;
  realVisualEnabled: boolean;
  realDistributionEnabled: boolean;
  /** Migração "GPT como motor criativo único" (PR 6/9). Mutuamente exclusiva com
   * `legacyCreativeEngineEnabled` por construção (`api-config.ts` deriva as duas de uma única
   * variável de ambiente) — nunca as duas ligadas, nunca as duas desligadas. Ver
   * `creative-engine-mode.ts`. */
  creativeEngineGptEnabled: boolean;
  legacyCreativeEngineEnabled: boolean;
};

export const DEFAULT_EXECUTION_FEATURE_FLAGS: ExecutionFeatureFlags = {
  realExecutionEnabled: false,
  realExecutionResearchEnabled: false,
  realPlanningEnabled: false,
  realCopyEnabled: false,
  realVisualEnabled: false,
  realDistributionEnabled: false,
  // Default da biblioteca (usado quando nada mais configura as flags, ex.: testes) — espelha o
  // default atual de produção (legado), que só muda no PR 8 (virada explícita do motor padrão).
  creativeEngineGptEnabled: false,
  legacyCreativeEngineEnabled: true,
};

export function serializeExecutionFeatureFlags(flags: ExecutionFeatureFlags): Record<string, boolean> {
  return {
    REAL_EXECUTION_ENABLED: flags.realExecutionEnabled,
    REAL_EXECUTION_RESEARCH_ENABLED: flags.realExecutionResearchEnabled,
    REAL_PLANNING_ENABLED: flags.realPlanningEnabled,
    REAL_COPY_ENABLED: flags.realCopyEnabled,
    REAL_VISUAL_ENABLED: flags.realVisualEnabled,
    REAL_DISTRIBUTION_ENABLED: flags.realDistributionEnabled,
    CREATIVE_ENGINE_GPT_ENABLED: flags.creativeEngineGptEnabled,
    LEGACY_CREATIVE_ENGINE_ENABLED: flags.legacyCreativeEngineEnabled,
  };
}
