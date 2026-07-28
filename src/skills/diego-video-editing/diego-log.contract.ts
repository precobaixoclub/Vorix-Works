export type DiegoLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "ContextConsulted"
  | "ContextIncomplete"
  | "EditingPlanStarted"
  | "AISupportRequested"
  | "AISupportApplied"
  | "AISupportSkipped"
  | "AISupportFailed"
  | "EditingPlanFinalized"
  | "RafaBriefingCreated"
  | "Error";

export type DiegoLogEntry = {
  id: string;
  occurredAt: string;
  action: DiegoLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type DiegoLoggerPort = {
  record(entry: DiegoLogEntry): Promise<void>;
};
