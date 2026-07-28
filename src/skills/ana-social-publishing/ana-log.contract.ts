export type AnaLogAction =
  | "RequestReceived"
  | "ClientResolved"
  | "ClientNotFound"
  | "PublishingRulesConsulted"
  | "ValidationStarted"
  | "ValidationFailed"
  | "MediaValidated"
  | "ArtifactHostingStarted"
  | "ArtifactHosted"
  | "ArtifactHostingFailed"
  | "PublicationStarted"
  | "PublicationScheduled"
  | "PublicationCompleted"
  | "PublicationFailed"
  | "Error";

export type AnaLogEntry = {
  id: string;
  occurredAt: string;
  action: AnaLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type AnaLoggerPort = {
  record(entry: AnaLogEntry): Promise<void>;
};
