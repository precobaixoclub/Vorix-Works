export type BiancaLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "DesignContextConsulted"
  | "ContextIncomplete"
  | "DesignStarted"
  | "AISupportRequested"
  | "AISupportApplied"
  | "AISupportSkipped"
  | "AISupportFailed"
  | "DesignFinalized"
  | "PedroBriefingCreated"
  | "Error";

export type BiancaLogEntry = {
  id: string;
  occurredAt: string;
  action: BiancaLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type BiancaLoggerPort = {
  record(entry: BiancaLogEntry): Promise<void>;
};
