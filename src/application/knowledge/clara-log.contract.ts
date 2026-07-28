import type { ClaraKnowledgeActor, ClaraKnowledgeModule } from "./clara.types.js";

export type ClaraLogAction =
  | "KnowledgeRequested"
  | "KnowledgeDelivered"
  | "KnowledgeCreated"
  | "KnowledgeUpdated"
  | "KnowledgeDeleted"
  | "KnowledgeSearched"
  | "KnowledgeVersionCreated";

export type ClaraLogEntry = {
  id: string;
  occurredAt: string;
  action: ClaraLogAction;
  message: string;
  actor?: ClaraKnowledgeActor;
  recordId?: string;
  clientId?: string;
  module?: ClaraKnowledgeModule;
  version?: number;
  metadata?: Record<string, unknown>;
};

export type ClaraLoggerPort = {
  record(entry: ClaraLogEntry): Promise<void>;
};
