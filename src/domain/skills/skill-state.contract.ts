export const SKILL_STATES = [
  "DISCOVERED",
  "LOADED",
  "READY",
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED",
  "DISABLED",
] as const;

export type SkillState = (typeof SKILL_STATES)[number];
