import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { SkillManifest } from "../../domain/skills/skill-manifest.contract.js";
import type { Skill, SkillExecutionContext, SkillResponse } from "../../domain/skills/skill.contract.js";
import type { SkillState } from "../../domain/skills/skill-state.contract.js";

export type DiscoveredSkillSource = {
  sourceId: string;
  location: string;
  manifest: unknown;
  modulePath?: string;
};

export type SkillManifestValidationResult =
  | { valid: true; manifest: SkillManifest }
  | { valid: false; errors: string[] };

export type RegisteredSkillRecord = {
  source: DiscoveredSkillSource;
  state: SkillState;
  manifest?: SkillManifest;
  skill?: Skill;
  validationErrors: string[];
  disabledReason?: string;
  loadedAt?: string;
  updatedAt: string;
};

export type HelenaExecutionCaller = "arthur" | "caio";

export type HelenaSkillExecutionRequest<TInput = unknown> = {
  requestedBy: HelenaExecutionCaller;
  capability: SkillCapability;
  input: TInput;
  context: Omit<SkillExecutionContext, "requestedBy" | "orchestratedBy">;
};

export type HelenaSkillExecutionResult<TOutput = unknown> = {
  skillId: string;
  state: SkillState;
  response: SkillResponse<TOutput>;
};
