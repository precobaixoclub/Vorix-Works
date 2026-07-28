export type CaioLogAction =
  | "WorkflowStarted"
  | "WorkflowResumed"
  | "StepStarted"
  | "StepCompleted"
  | "StepWaitingHumanApproval"
  | "StepWaitingAssistedGeneration"
  | "StepWaitingDeveloperAI"
  | "StepFailed"
  | "WorkflowCompleted"
  | "WorkflowFailed"
  | "WorkflowCancelled";

export type CaioLogEntry = {
  id: string;
  occurredAt: string;
  action: CaioLogAction;
  message: string;
  executionId: string;
  planId?: string;
  stepId?: string;
  metadata?: Record<string, unknown>;
};

export type CaioLoggerPort = {
  record(entry: CaioLogEntry): Promise<void>;
};
