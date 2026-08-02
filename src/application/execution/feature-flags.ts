export type ExecutionFeatureFlags = {
  realExecutionEnabled: boolean;
  realExecutionResearchEnabled: boolean;
  realPlanningEnabled: boolean;
  realCopyEnabled: boolean;
  realVisualEnabled: boolean;
  realDistributionEnabled: boolean;
};

export const DEFAULT_EXECUTION_FEATURE_FLAGS: ExecutionFeatureFlags = {
  realExecutionEnabled: false,
  realExecutionResearchEnabled: false,
  realPlanningEnabled: false,
  realCopyEnabled: false,
  realVisualEnabled: false,
  realDistributionEnabled: false,
};

export function serializeExecutionFeatureFlags(flags: ExecutionFeatureFlags): Record<string, boolean> {
  return {
    REAL_EXECUTION_ENABLED: flags.realExecutionEnabled,
    REAL_EXECUTION_RESEARCH_ENABLED: flags.realExecutionResearchEnabled,
    REAL_PLANNING_ENABLED: flags.realPlanningEnabled,
    REAL_COPY_ENABLED: flags.realCopyEnabled,
    REAL_VISUAL_ENABLED: flags.realVisualEnabled,
    REAL_DISTRIBUTION_ENABLED: flags.realDistributionEnabled,
  };
}
