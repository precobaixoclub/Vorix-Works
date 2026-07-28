import type { ExecutionPlan, ExecutionPlanStep } from "../orchestration/execution-plan.contract.js";
import type { SkillResponse } from "../../domain/skills/skill.contract.js";
import type { ZunoRuntimeMode } from "../runtime/zuno-runtime-mode.js";

export const WORKFLOW_EXECUTION_STATES = [
  "CREATED",
  "RUNNING",
  "WAITING_HUMAN_APPROVAL",
  "WAITING_ASSISTED_GENERATION",
  "WAITING_DEVELOPER_AI",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type WorkflowExecutionState = (typeof WORKFLOW_EXECUTION_STATES)[number];

export const WORKFLOW_STEP_STATES = [
  "PENDING",
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
] as const;

export type WorkflowStepState = (typeof WORKFLOW_STEP_STATES)[number];

export type WorkflowExecutionRequest = {
  plan: ExecutionPlan;
  locale?: string;
  clientId?: string;
  tenantId?: string;
  dryRun?: boolean;
  mode?: ZunoRuntimeMode;
  correlationId?: string;
};

export type WorkflowStepExecutionReport = {
  stepId: string;
  order: number;
  name: string;
  type: ExecutionPlanStep["type"];
  skillCapability?: ExecutionPlanStep["skillCapability"];
  state: WorkflowStepState;
  startedAt?: string;
  finishedAt?: string;
  waitingReason?: string;
  skillId?: string;
  response?: SkillResponse;
  artifactSummary?: WorkflowArtifactSummary;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};

export type WorkflowArtifactSummary = {
  htmlPaths: string[];
  imagePaths: string[];
  videoPaths: string[];
  captionPaths: string[];
  publicationPaths: string[];
  metadataPaths: string[];
  zipPaths: string[];
  hashtagsPaths: string[];
  reportPaths: string[];
};

export type WorkflowExecutionReport = {
  executionId: string;
  planId: string;
  clientId: string;
  tenantId?: string;
  state: WorkflowExecutionState;
  startedAt: string;
  finishedAt?: string;
  waitingForStepId?: string;
  message: string;
  steps: WorkflowStepExecutionReport[];
  artifactSummary: WorkflowArtifactSummary;
  planSnapshot: ExecutionPlan;
  locale: string;
  dryRun: boolean;
  mode: ZunoRuntimeMode;
  correlationId: string;
};

export type WorkflowHumanApprovalInput = {
  confirmed: boolean;
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
};
