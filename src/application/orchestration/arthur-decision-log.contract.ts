import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { ArthurSupportedChannel } from "./arthur.types.js";

export type ArthurDecisionLogEntry = {
  id: string;
  planId: string;
  occurredAt: string;
  objective: string;
  detectedChannels: ArthurSupportedChannel[];
  selectedCapabilities: SkillCapability[];
  stepCount: number;
  reason: string;
  constraints: string[];
};

export type ArthurDecisionLoggerPort = {
  record(entry: ArthurDecisionLogEntry): Promise<void>;
};
