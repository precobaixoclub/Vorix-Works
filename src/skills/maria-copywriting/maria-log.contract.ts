export type MariaLogAction =
  | "BriefingReceived"
  | "ValidationFailed"
  | "GenerationStarted"
  | "PromptBuilt"
  | "AttemptStarted"
  | "QualityEvaluated"
  | "CopyApproved"
  | "CopyDelivered"
  | "ProviderError"
  | "Error";

export type MariaLogEntry = {
  id: string;
  occurredAt: string;
  action: MariaLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  attempt?: number;
  metadata?: Record<string, unknown>;
};

export type MariaLoggerPort = {
  record(entry: MariaLogEntry): Promise<void>;
};
