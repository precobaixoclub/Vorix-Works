export type SofiaLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "VisualIdentityConsulted"
  | "ContextIncomplete"
  | "DirectionStarted"
  | "AISupportRequested"
  | "AISupportApplied"
  | "AISupportSkipped"
  | "AISupportFailed"
  | "DirectionFinalized"
  | "BiancaBriefingCreated"
  | "Error";

export type SofiaLogEntry = {
  id: string;
  occurredAt: string;
  action: SofiaLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type SofiaLoggerPort = {
  record(entry: SofiaLogEntry): Promise<void>;
};
