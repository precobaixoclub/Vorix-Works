export type IcaroLogAction =
  | "AIRequestReceived"
  | "ProviderSelected"
  | "ModelSelected"
  | "AICallStarted"
  | "AICallFinished"
  | "RetryScheduled"
  | "FallbackStarted"
  | "Timeout"
  | "Error"
  | "ResponseDelivered";

export type IcaroLogEntry = {
  id: string;
  occurredAt: string;
  action: IcaroLogAction;
  message: string;
  specialistId?: string;
  executionId?: string;
  taskId?: string;
  providerId?: string;
  modelId?: string;
  attempt?: number;
  metadata?: Record<string, unknown>;
};

export type IcaroLoggerPort = {
  record(entry: IcaroLogEntry): Promise<void>;
};
