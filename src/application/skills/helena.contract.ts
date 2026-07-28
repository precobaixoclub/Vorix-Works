import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { HelenaSkillExecutionRequest, HelenaSkillExecutionResult, RegisteredSkillRecord } from "./helena.types.js";

export type HelenaSkillManagerPort = {
  discoverAndLoadSkills(): Promise<RegisteredSkillRecord[]>;
  findSkillByCapability(capability: SkillCapability): Promise<RegisteredSkillRecord | undefined>;
  executeSkill<TInput = unknown, TOutput = unknown>(
    request: HelenaSkillExecutionRequest<TInput>,
  ): Promise<HelenaSkillExecutionResult<TOutput>>;
};
