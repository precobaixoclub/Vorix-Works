export type MotionDesignLogAction =
  | "RequestReceived"
  | "ValidationFailed"
  | "StrategyDecided"
  | "TimelineBuilt"
  | "PlanValidated"
  | "PlanFinalized"
  | "Error";

export type MotionDesignLogEntry = {
  id: string;
  occurredAt: string;
  action: MotionDesignLogAction;
  message: string;
  executionId?: string;
  taskId?: string;
  clientId?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type MotionDesignLoggerPort = {
  record(entry: MotionDesignLogEntry): Promise<void>;
};
