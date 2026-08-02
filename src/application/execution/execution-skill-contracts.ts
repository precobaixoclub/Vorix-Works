import type { SideEffectPolicy } from "../../domain/execution/execution.model.js";
import type { ExecutionCapability, PlanningArtifactType, TaskType } from "../../domain/planning/planning.model.js";
import type { ExecutionFeatureFlags } from "./feature-flags.js";

export type ExecutionSkillContract = {
  executionCapability: ExecutionCapability;
  taskType: TaskType;
  outputPort: string;
  artifactType: PlanningArtifactType;
  schemaId: string;
  schemaVersion: number;
  requiredOutputFields: readonly string[];
  skillCapabilities: readonly string[];
  featureFlag?: keyof ExecutionFeatureFlags;
  sideEffectPolicy: SideEffectPolicy;
};

export const EXECUTION_SKILL_CONTRACTS: readonly ExecutionSkillContract[] = [
  {
    executionCapability: "editorial_research",
    taskType: "research",
    outputPort: "context",
    artifactType: "document",
    schemaId: "research.context",
    schemaVersion: 1,
    requiredOutputFields: ["campaignObjective", "recommendedFormatLabel", "recommendedChannel", "recommendedCta"],
    skillCapabilities: ["editorial_planning"],
    featureFlag: "realExecutionResearchEnabled",
    sideEffectPolicy: "publication_preview",
  },
  {
    executionCapability: "strategic_planning",
    taskType: "campaign_structure",
    outputPort: "structure",
    artifactType: "document",
    schemaId: "campaign_structure.structure",
    schemaVersion: 1,
    requiredOutputFields: ["overallStrategy", "objective", "mariaBriefing", "sofiaBriefing"],
    skillCapabilities: ["marketing_strategy"],
    featureFlag: "realPlanningEnabled",
    sideEffectPolicy: "external_read",
  },
  {
    executionCapability: "copywriting",
    taskType: "copy_generation",
    outputPort: "copy",
    artifactType: "text",
    schemaId: "copy_generation.copy",
    schemaVersion: 1,
    requiredOutputFields: ["title", "caption", "cta", "hashtags"],
    skillCapabilities: ["copywriting"],
    featureFlag: "realCopyEnabled",
    sideEffectPolicy: "external_read",
  },
  {
    executionCapability: "visual_design",
    taskType: "visual_generation",
    outputPort: "visual",
    artifactType: "carousel",
    schemaId: "visual_generation.visual",
    schemaVersion: 1,
    requiredOutputFields: ["generationSummary", "imageCount", "images"],
    skillCapabilities: ["art_direction", "social_media_design", "image_generation"],
    featureFlag: "realVisualEnabled",
    sideEffectPolicy: "external_write",
  },
  {
    executionCapability: "distribution",
    taskType: "publication",
    outputPort: "manifest",
    artifactType: "document",
    schemaId: "publication.manifest",
    schemaVersion: 1,
    requiredOutputFields: ["overallStatus", "publishMode", "requestedChannels"],
    skillCapabilities: ["social_publishing"],
    featureFlag: "realDistributionEnabled",
    sideEffectPolicy: "external_read",
  },
] as const;

export function getExecutionSkillContract(capability: ExecutionCapability, taskType: TaskType): ExecutionSkillContract | undefined {
  return EXECUTION_SKILL_CONTRACTS.find((contract) => contract.executionCapability === capability && contract.taskType === taskType);
}
