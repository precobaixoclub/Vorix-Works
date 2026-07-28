export type EduardoLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "ContextConsulted"
  | "ContextIncomplete"
  | "PlanningStarted"
  | "AISupportRequested"
  | "AISupportApplied"
  | "AISupportSkipped"
  | "AISupportFailed"
  | "FeedbackHistoryConsulted"
  | "FeedbackHistorySkipped"
  | "FeedbackHistoryFailed"
  | "PlanningFinalized"
  | "JoaoBriefingCreated"
  | "Error";

export type EduardoLogEntry = {
  id: string;
  occurredAt: string;
  action: EduardoLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type EduardoLoggerPort = {
  record(entry: EduardoLogEntry): Promise<void>;
};
