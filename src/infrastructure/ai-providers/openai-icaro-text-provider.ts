import type { AIProviderPort, AIProviderProfile, AIProviderRequest, AIProviderResponse } from "../../application/ports/ai-provider.port.js";

export type OpenAiIcaroTextProviderConfig = {
  apiBaseUrl?: string;
  getApiKey: () => Promise<string | undefined>;
};

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const MODEL_ID = "gpt-4o-mini";

/**
 * Ponte real de texto entre o Ícaro (`IcaroAIBrain`) e a OpenAI — sem isto, João (`taskType:
 * "analysis"`), Maria (`"text_generation"`) e Lucas (`"review"`) nunca tinham nenhum Provider que
 * respondesse a essas tarefas: o único Provider registrado no container (`OpenAiIcaroImageProvider`)
 * só suporta `"image_generation"` (Pedro). João degrada bem sem IA (heurística determinística), mas
 * Maria EXIGE Ícaro (`IcaroBrainPort` não é opcional na sua Skill) — sem este provider, toda
 * chamada de `copy_generation` no grafo `content_request-visual-only-v2` falharia sempre
 * (`AI_PROVIDER_FAILURE` em todas as 3 tentativas), quebrando a geração de peça de ponta a ponta.
 */
export class OpenAiIcaroTextProvider implements AIProviderPort {
  readonly profile: AIProviderProfile = {
    id: "openai-icaro-text",
    name: "OpenAI (texto/análise)",
    kind: "text",
    priority: 10,
    enabled: true,
    supportedTaskTypes: ["text_generation", "analysis", "review", "classification", "summary", "translation"],
    models: [{
      id: MODEL_ID,
      supportedTaskTypes: ["text_generation", "analysis", "review", "classification", "summary", "translation"],
      priority: 10,
      qualityScore: 0.8,
      speedScore: 0.9,
      costPer1kInputTokens: 0.00015,
      costPer1kOutputTokens: 0.0006,
      defaultTemperature: 0.7,
      defaultMaxTokens: 2400,
      maxTokens: 4096,
    }],
  };

  constructor(
    private readonly config: OpenAiIcaroTextProviderConfig,
    private readonly httpClient: typeof fetch = fetch,
  ) {}

  async execute(request: AIProviderRequest): Promise<AIProviderResponse> {
    const apiKey = await this.config.getApiKey();
    if (!apiKey) {
      const error = new Error("Chave da OpenAI não configurada para o Provider de texto do Ícaro.");
      Object.assign(error, { kind: "invalid_request", retryable: false });
      throw error;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      // `imageUrls` (ver `AIProviderRequest.imageUrls`) — quando presente, envia o prompt como
      // blocos multimodais (texto + `image_url`) em vez de uma string simples; `gpt-4o-mini` já é
      // multimodal, então isto não exige um provider novo. Usado por checagens de visão dentro de
      // uma análise de texto (ex.: Lucas comparando a imagem gerada com a de referência).
      const requestContent = request.imageUrls?.length
        ? [{ type: "text", text: request.prompt }, ...request.imageUrls.map((url) => ({ type: "image_url", image_url: { url } }))]
        : request.prompt;
      const response = await this.httpClient(`${this.config.apiBaseUrl ?? DEFAULT_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: request.model || MODEL_ID,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          ...(request.expectedOutput === "json" ? { response_format: { type: "json_object" } } : {}),
          messages: [{ role: "user", content: requestContent }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const error = new Error(`OpenAI respondeu ${response.status} ao Provider de texto do Ícaro. ${body}`.trim());
        Object.assign(error, {
          kind: response.status === 429 ? "rate_limit" : response.status >= 500 ? "temporary" : "provider_error",
          retryable: response.status === 429 || response.status >= 500,
        });
        throw error;
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        model?: string;
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        const error = new Error("OpenAI não retornou conteúdo para o Provider de texto do Ícaro.");
        Object.assign(error, { kind: "provider_error", retryable: false });
        throw error;
      }

      return {
        content,
        model: body.model ?? MODEL_ID,
        tokens: {
          input: body.usage?.prompt_tokens,
          output: body.usage?.completion_tokens,
          total: body.usage?.total_tokens,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
