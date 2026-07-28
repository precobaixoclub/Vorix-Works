export type VanessaLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "ContextConsulted"
  | "ContextIncomplete"
  | "DirectionStarted"
  | "AISupportRequested"
  | "AISupportApplied"
  | "AISupportSkipped"
  | "AISupportFailed"
  | "DirectionFinalized"
  | "DiegoBriefingCreated"
  | "Error";

export type VanessaLogEntry = {
  id: string;
  occurredAt: string;
  action: VanessaLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type VanessaLoggerPort = {
  record(entry: VanessaLogEntry): Promise<void>;
};
