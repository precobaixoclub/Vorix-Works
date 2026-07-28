export type AITaskType =
  | "text_generation"
  | "image_generation"
  | "analysis"
  | "classification"
  | "summary"
  | "translation"
  | "review";

export type AIProviderKind = "text" | "image" | "multimodal";

export type AIProviderFailureKind =
  | "temporary"
  | "timeout"
  | "rate_limit"
  | "invalid_request"
  | "provider_error";

export type AITokenUsage = {
  input: number;
  output: number;
  total: number;
};

export type AICostReport = {
  estimated: number;
  actual?: number;
  currency: "USD" | "BRL";
};

export type AIModelProfile = {
  id: string;
  supportedTaskTypes: AITaskType[];
  priority: number;
  qualityScore: number;
  speedScore: number;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
  defaultTemperature: number;
  defaultMaxTokens: number;
  maxTokens: number;
};

export type AIProviderProfile = {
  id: string;
  name: string;
  kind: AIProviderKind;
  priority: number;
  enabled: boolean;
  supportedTaskTypes: AITaskType[];
  models: AIModelProfile[];
};

export type AIProviderRequest = {
  taskType: AITaskType;
  prompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  context?: Record<string, unknown>;
  constraints?: string[];
  expectedOutput?: "text" | "json" | "image" | "structured";
};

export type AIProviderResponse = {
  content: unknown;
  model: string;
  tokens?: Partial<AITokenUsage>;
  cost?: Partial<AICostReport>;
  warnings?: string[];
  metadata?: Record<string, unknown>;
};

export type AIProviderPort = {
  profile: AIProviderProfile;
  execute(request: AIProviderRequest): Promise<AIProviderResponse>;
};
