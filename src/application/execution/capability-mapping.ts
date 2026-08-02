import type { ExecutionCapability } from "../../domain/planning/planning.model.js";

export const EXECUTION_CAPABILITY_MAPPING_VERSION = 1;

export type ExecutionCapabilityMapping = {
  mappingVersion: number;
  executionCapability: ExecutionCapability;
  skillCapability: string;
};

const MAPPING_BY_EXECUTION_CAPABILITY: Record<ExecutionCapability, string> = {
  editorial_research: "editorial_planning",
  strategic_planning: "marketing_strategy",
  copywriting: "copywriting",
  visual_design: "image_generation",
  human_review: "quality_review",
  distribution: "social_publishing",
};

export function mapExecutionCapabilityToSkillCapability(capability: ExecutionCapability): ExecutionCapabilityMapping {
  const skillCapability = MAPPING_BY_EXECUTION_CAPABILITY[capability];
  if (!skillCapability) {
    throw new Error(`EXECUTION_CAPABILITY_MAPPING_MISSING: capability "${capability}" não possui mapping explícito.`);
  }
  return {
    mappingVersion: EXECUTION_CAPABILITY_MAPPING_VERSION,
    executionCapability: capability,
    skillCapability,
  };
}
