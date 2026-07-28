import type { SkillCapability, SkillResponsibilityBoundary } from "./skill-capability.contract.js";

export const SKILL_MANIFEST_STATUSES = ["experimental", "stable", "deprecated"] as const;

export type SkillManifestStatus = (typeof SKILL_MANIFEST_STATUSES)[number];

export type SkillIOContract = {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
};

export type SkillDependencyDeclaration = {
  name: string;
  version?: string;
  optional?: boolean;
};

export type SkillCompatibility = {
  zuno: string;
};

export type SkillRuntimeDeclaration = {
  entrypoint: string;
};

export type SkillManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  capabilities: SkillCapability[];
  inputs: SkillIOContract[];
  outputs: SkillIOContract[];
  dependencies: SkillDependencyDeclaration[];
  status: SkillManifestStatus;
  enabled: boolean;
  compatibility: SkillCompatibility;
  runtime: SkillRuntimeDeclaration;
  responsibilityBoundary: SkillResponsibilityBoundary;
  owner: "helena-managed";
};
