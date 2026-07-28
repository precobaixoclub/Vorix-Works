export type RafaLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "ContextConsulted"
  | "ContextIncomplete"
  | "PromptBuilt"
  | "RenderingStarted"
  | "LocalRenderingSkipped"
  | "LocalRenderingFailed"
  | "LocalRenderingCompleted"
  | "AssistedGenerationRequested"
  | "AssistedVideoValidationFailed"
  | "AssistedVideoAccepted"
  | "ArtifactCreated"
  | "Error";

export type RafaLogEntry = {
  id: string;
  occurredAt: string;
  action: RafaLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type RafaLoggerPort = {
  record(entry: RafaLogEntry): Promise<void>;
};
