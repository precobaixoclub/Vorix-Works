export type PedroLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "ClientResolved"
  | "ClientNotFound"
  | "VisualContextConsulted"
  | "ContextIncomplete"
  | "ProductionBriefingValidated"
  | "PromptBuilt"
  | "VisualEnrichmentApplied"
  | "GenerationStarted"
  | "GenerationFinished"
  | "ArtifactCreated"
  | "AssistedGenerationRequested"
  | "AssistedImageValidationFailed"
  | "AssistedImageAccepted"
  | "Error";

export type PedroLogEntry = {
  id: string;
  occurredAt: string;
  action: PedroLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type PedroLoggerPort = {
  record(entry: PedroLogEntry): Promise<void>;
};
