export type NoraLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "ContextConsulted"
  | "NarrationPlanBuilt"
  | "AssistedGenerationRequested"
  | "AssistedAudioValidationFailed"
  | "AssistedAudioAccepted"
  | "ArtifactCreated"
  | "Error";

export type NoraLogEntry = {
  id: string;
  occurredAt: string;
  action: NoraLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type NoraLoggerPort = {
  record(entry: NoraLogEntry): Promise<void>;
};
