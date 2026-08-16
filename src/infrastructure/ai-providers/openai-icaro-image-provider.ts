import type { AIProviderPort, AIProviderProfile, AIProviderRequest, AIProviderResponse } from "../../application/ports/ai-provider.port.js";
import type { AiMediaProviderAdapterPort } from "../../application/ports/ai-media-provider-adapter.port.js";

export type OpenAiIcaroImageProviderConfig = {
  modelId?: string;
};

/**
 * Ponte entre `AIProviderPort` (o que `IcaroAIBrain`/Pedro consomem) e o `AiMediaProviderAdapterPort`
 * real (`OpenAiImageProviderAdapter`, já resolve a chave via `secretManager` e já persiste a imagem
 * no `ObjectStoragePort` — ver `persistGeneratedImage` em `container.ts`). Sem esta ponte, nenhuma
 * classe do repositório implementava `AIProviderPort`, e Pedro caía num Proxy que lançava erro
 * ("IcaroBrainPort não configurado") assim que tentava gerar uma imagem.
 *
 * Só suporta `taskType: "image_generation"` — o único que Pedro chama; qualquer outro lança erro
 * explícito em vez de fingir sucesso. `OpenAiImageProviderAdapter.generate()` sempre pede 1 imagem
 * por chamada (`n: 1`, hardcoded na API da OpenAI) — carrossel (`imageCount > 1`) chama várias
 * vezes em sequência, mesma requisição de formato único repetida N vezes.
 */
export class OpenAiIcaroImageProvider implements AIProviderPort {
  readonly profile: AIProviderProfile;

  constructor(
    private readonly mediaProvider: AiMediaProviderAdapterPort,
    private readonly config: OpenAiIcaroImageProviderConfig = {},
  ) {
    const modelId = config.modelId ?? "gpt-image-1";
    this.profile = {
      id: "openai-icaro-image",
      name: "OpenAI (imagem, via Ícaro)",
      kind: "image",
      priority: 1,
      enabled: true,
      supportedTaskTypes: ["image_generation"],
      models: [
        {
          id: modelId,
          supportedTaskTypes: ["image_generation"],
          priority: 1,
          qualityScore: 0.8,
          speedScore: 0.6,
          costPer1kInputTokens: 0,
          costPer1kOutputTokens: 0,
          defaultTemperature: 1,
          defaultMaxTokens: 0,
          maxTokens: 0,
        },
      ],
    };
  }

  async execute(request: AIProviderRequest): Promise<AIProviderResponse> {
    if (request.taskType !== "image_generation") {
      throw new Error(`OpenAiIcaroImageProvider só suporta "image_generation" — recebeu "${request.taskType}".`);
    }

    const tenantId = typeof request.context?.clientId === "string" ? request.context.clientId : "unknown-tenant";
    const workspaceId = typeof request.context?.workspaceId === "string" ? request.context.workspaceId : undefined;
    const imageCount = typeof request.context?.imageCount === "number" && request.context.imageCount > 0 ? request.context.imageCount : 1;
    const modelId = request.model || this.profile.models[0].id;

    const images: Array<{ uri: string; mimeType: string }> = [];
    for (let index = 0; index < imageCount; index += 1) {
      const result = await this.mediaProvider.generate({
        operationTypeCode: "image_generation",
        modelId,
        prompt: request.prompt,
        tenantId,
        workspaceId,
        params: { size: "1024x1024" },
        timeoutMs: request.timeoutMs,
      });
      if (!result.ok) {
        throw new Error(`OpenAI (${result.category}): ${result.message}`);
      }
      images.push({ uri: result.mediaUrl, mimeType: "image/png" });
    }

    return {
      content: JSON.stringify({ images }),
      model: modelId,
      tokens: { input: 0, output: 0, total: 0 },
      cost: { estimated: 0, currency: "USD" },
    };
  }
}
