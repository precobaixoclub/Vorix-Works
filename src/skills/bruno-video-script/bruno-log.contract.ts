export type BrunoLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "ContextConsulted"
  | "ContextIncomplete"
  | "ScriptStarted"
  | "AISupportRequested"
  | "AISupportApplied"
  | "AISupportSkipped"
  | "AISupportFailed"
  | "ScriptFinalized"
  | "VanessaBriefingCreated"
  | "ShotPlanningCompleted"
  | "Error";

export type BrunoLogEntry = {
  id: string;
  occurredAt: string;
  action: BrunoLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type BrunoLoggerPort = {
  record(entry: BrunoLogEntry): Promise<void>;
};
