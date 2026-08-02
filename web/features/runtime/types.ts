/** Espelha `src/domain/runtime/runtime.model.ts` e `src/application/runtime/runtime-use-cases.ts`
 * (backend, Sprint 10). Só leitura — sem nenhum verbo de escrita neste domínio no frontend. */

import type { Planning } from "@/features/planning/types";

export const RUNTIME_STATES = ["draft", "validating", "validated", "validation_failed", "superseded"] as const;
export type RuntimeState = (typeof RUNTIME_STATES)[number];

export type RuntimeSourceContext = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  briefingId: string;
  preparedCommandId: string;
  planningId: string;
};

export const RUNTIME_VALIDATION_ISSUE_SEVERITIES = ["error", "warning"] as const;
export type RuntimeValidationIssueSeverity = (typeof RUNTIME_VALIDATION_ISSUE_SEVERITIES)[number];

export type RuntimeValidationIssue = {
  code: string;
  message: string;
  field?: string;
  severity: RuntimeValidationIssueSeverity;
};

export type RuntimeValidationReport = {
  valid: boolean;
  issues: readonly RuntimeValidationIssue[];
  validatedAt: string;
};

export type RuntimePlan = {
  id: string;
  sourceContext: RuntimeSourceContext;
  status: RuntimeState;
  runtimeSchemaVersion: number;
  translatorVersion: number;
  translatorStrategy: string;
  translationTemplate: string;
  sourceGraphFingerprint: string;
  runtimeFingerprint?: string;
  validationReport: RuntimeValidationReport;
  createdAt: string;
  updatedAt: string;
  supersededAt?: string;
};

export const RUNTIME_TASK_STATUSES = ["prepared"] as const;
export type RuntimeTaskStatus = (typeof RUNTIME_TASK_STATUSES)[number];

export type RuntimeTask = {
  id: string;
  runtimePlanId: string;
  executionTaskId: string;
  type: string;
  capability: string;
  status: RuntimeTaskStatus;
  createdAt: string;
};

export type RuntimeTaskOutputPort = {
  id: string;
  runtimePlanId: string;
  runtimeTaskId: string;
  portKey: string;
  artifactType: string;
  description: string;
  createdAt: string;
};

export type RuntimeTaskInputPort = {
  id: string;
  runtimePlanId: string;
  runtimeTaskId: string;
  portKey: string;
  acceptedArtifactTypes: readonly string[];
  required: boolean;
  description: string;
  createdAt: string;
};

export type RuntimeBinding = {
  id: string;
  runtimePlanId: string;
  fromRuntimeTaskId: string;
  fromOutputPort: string;
  toRuntimeTaskId: string;
  toInputPort: string;
  createdAt: string;
};

export type ArtifactSchema = {
  artifactType: string;
  description: string;
  expectedFields: readonly string[];
};

export const RUNTIME_ARTIFACT_STATUSES = ["expected"] as const;
export type RuntimeArtifactStatus = (typeof RUNTIME_ARTIFACT_STATUSES)[number];

export type RuntimeArtifact = {
  id: string;
  runtimePlanId: string;
  runtimeTaskId: string;
  schema: ArtifactSchema;
  status: RuntimeArtifactStatus;
  createdAt: string;
};

export type RuntimeContext = {
  sourceContext: RuntimeSourceContext;
  planning: Planning;
  runtimePlanId: string;
  runtimeStatus: RuntimeState;
};

export type RuntimeDetail = {
  runtimePlan: RuntimePlan;
  sourceContext: RuntimeSourceContext;
  validationReport: RuntimeValidationReport;
  tasks: readonly RuntimeTask[];
  artifacts: readonly RuntimeArtifact[];
  context: RuntimeContext;
};

export type RuntimeBindingsView = {
  bindings: readonly RuntimeBinding[];
  inputs: readonly RuntimeTaskInputPort[];
  outputs: readonly RuntimeTaskOutputPort[];
};

export type RuntimeDetails = RuntimeBindingsView & {
  tasks: readonly RuntimeTask[];
  artifacts: readonly RuntimeArtifact[];
  issues: readonly RuntimeValidationIssue[];
};
