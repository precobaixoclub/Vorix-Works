export type HelenaLogAction =
  | "SkillDiscovered"
  | "SkillLoaded"
  | "SkillIgnored"
  | "ManifestInvalid"
  | "CapabilityFound"
  | "CapabilityMissing"
  | "ExecutionStarted"
  | "ExecutionCompleted"
  | "ExecutionFailed"
  | "StateChanged";

export type HelenaLogEntry = {
  id: string;
  occurredAt: string;
  action: HelenaLogAction;
  message: string;
  skillId?: string;
  capability?: string;
  executionId?: string;
  metadata?: Record<string, unknown>;
};

export type HelenaLoggerPort = {
  record(entry: HelenaLogEntry): Promise<void>;
};
