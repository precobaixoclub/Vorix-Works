import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { Skill } from "../../domain/skills/skill.contract.js";
import type { SkillState } from "../../domain/skills/skill-state.contract.js";
import type { DiscoveredSkillSource, RegisteredSkillRecord, SkillManifestValidationResult } from "./helena.types.js";

export type SkillDiscoveryPort = {
  discover(): Promise<DiscoveredSkillSource[]>;
};

export type SkillModuleLoaderPort = {
  load(source: DiscoveredSkillSource): Promise<Skill>;
};

export type SkillManifestValidatorPort = {
  validate(manifest: unknown): SkillManifestValidationResult;
};

export type SkillRegistryPort = {
  registerDiscovered(source: DiscoveredSkillSource, occurredAt: string): RegisteredSkillRecord;
  attachManifest(sourceId: string, manifest: RegisteredSkillRecord["manifest"], occurredAt: string): RegisteredSkillRecord;
  attachSkill(sourceId: string, skill: Skill, occurredAt: string): RegisteredSkillRecord;
  updateState(sourceId: string, state: SkillState, occurredAt: string, details?: { validationErrors?: string[]; disabledReason?: string }): RegisteredSkillRecord;
  findByCapability(capability: SkillCapability): RegisteredSkillRecord | undefined;
  getBySkillId(skillId: string): RegisteredSkillRecord | undefined;
  getBySourceId(sourceId: string): RegisteredSkillRecord | undefined;
  list(): RegisteredSkillRecord[];
};
