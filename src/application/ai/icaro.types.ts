import type {
  AICostReport,
  AIModelProfile,
  AIProviderFailureKind,
  AIProviderProfile,
  AITaskType,
  AITokenUsage,
} from "../ports/ai-provider.port.js";

export type IcaroAIRequest = {
  taskType: AITaskType;
  prompt: string;
  specialistId: string;
  executionId?: string;
  taskId?: string;
  correlationId?: string;
  context?: Record<string, unknown>;
  constraints?: string[];
  expectedOutput?: "text" | "json" | "image" | "structured";
  priority?: "quality" | "speed" | "cost" | "balanced";
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type IcaroAIResponseStatus = "completed" | "failed";

export type IcaroAttemptSummary = {
  total: number;
  providerAttempt: number;
  providerId?: string;
};

export type IcaroAIResponse = {
  status: IcaroAIResponseStatus;
  provider: {
    id?: string;
    name?: string;
  };
  model: {
    id?: string;
  };
  durationMs: number;
  tokens: AITokenUsage;
  cost: AICostReport;
  content?: unknown;
  warnings: string[];
  attempt: IcaroAttemptSummary;
  fallbackUsed: boolean;
  error?: {
    kind: AIProviderFailureKind | "no_provider" | "unknown";
    message: string;
    retryable: boolean;
  };
};

export type IcaroProviderSelection = {
  provider: AIProviderProfile;
  model: AIModelProfile;
  score: number;
  reason: string;
};

export type IcaroRetryPolicy = {
  maxAttemptsPerProvider: number;
  retryableFailures: AIProviderFailureKind[];
};

export type IcaroFallbackPolicy = {
  enabled: boolean;
  maxFallbackProviders: number;
};

export type IcaroCachePolicy = {
  enabled: boolean;
  ttlSeconds?: number;
};

export type IcaroTaskConfiguration = {
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
};

export type IcaroProviderAttemptReport = {
  providerId: string;
  modelId: string;
  attempt: number;
  totalAttempt: number;
  durationMs: number;
  status: "completed" | "failed";
  fallback: boolean;
  error?: string;
};

export type IcaroConsumptionRecord = {
  id: string;
  occurredAt: string;
  specialistId: string;
  taskType: AITaskType;
  providerId?: string;
  modelId?: string;
  executionId?: string;
  taskId?: string;
  durationMs: number;
  tokens: AITokenUsage;
  cost: AICostReport;
  status: IcaroAIResponseStatus;
};

export type IcaroIdGenerator = {
  create(prefix: string): string;
};

export type AIRequestCachePort = {
  createKey(request: IcaroAIRequest): Promise<string>;
  get(key: string): Promise<IcaroAIResponse | undefined>;
  set(key: string, response: IcaroAIResponse, ttlSeconds?: number): Promise<void>;
};

export type IcaroCostLedgerPort = {
  record(entry: IcaroConsumptionRecord): Promise<void>;
};
