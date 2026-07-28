export type LucasLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "ContextConsulted"
  | "ContextIncomplete"
  | "ReviewStarted"
  | "AISupportRequested"
  | "AISupportApplied"
  | "AISupportSkipped"
  | "AISupportFailed"
  | "ChecklistValidated"
  | "ReviewFinished"
  | "Error";

export type LucasLogEntry = {
  id: string;
  occurredAt: string;
  action: LucasLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type LucasLoggerPort = {
  record(entry: LucasLogEntry): Promise<void>;
};
