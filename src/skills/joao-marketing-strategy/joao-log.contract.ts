export type JoaoLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "ContextConsulted"
  | "ContextIncomplete"
  | "StrategyStarted"
  | "AISupportRequested"
  | "AISupportApplied"
  | "AISupportSkipped"
  | "AISupportFailed"
  | "StrategyFinalized"
  | "MariaBriefingCreated"
  | "Error";

export type JoaoLogEntry = {
  id: string;
  occurredAt: string;
  action: JoaoLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type JoaoLoggerPort = {
  record(entry: JoaoLogEntry): Promise<void>;
};
