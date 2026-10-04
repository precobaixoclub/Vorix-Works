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
  | "provider_error"
  /** Achado real em produção (incidente de quota OpenAI): distinto de `"rate_limit"` de propósito
   * — um rate limit normal é transitório (se resolve sozinho em segundos); crédito/saldo do
   * provider esgotado NUNCA se resolve sozinho (precisa de intervenção financeira na conta do
   * provider). Confundir os dois fazia o pipeline tentar de novo (gastando a 2ª tentativa de JSON
   * do plano) contra um erro que nunca ia se resolver sozinho. Nunca retryable. */
  | "quota_exhausted";

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
  /** URLs de imagens públicas a enviar junto com o prompt, para providers de texto com capacidade
   * multimodal (ex.: `gpt-4o-mini`) — usado por checagens de visão dentro de uma análise de texto
   * (ex.: Lucas comparando a imagem gerada com a imagem de referência), nunca por geração de
   * imagem em si (isso continua exclusivo de `taskType: "image_generation"`). Providers que não
   * suportam entrada de imagem devem ignorar este campo, nunca lançar erro por causa dele. */
  imageUrls?: string[];
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
