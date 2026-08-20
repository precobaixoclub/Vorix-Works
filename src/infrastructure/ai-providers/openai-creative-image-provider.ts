import type { AIProviderPort, AIProviderProfile, AIProviderRequest, AIProviderResponse } from "../../application/ports/ai-provider.port.js";
import type { AiMediaProviderAdapterPort } from "../../application/ports/ai-media-provider-adapter.port.js";
import { buildCreativeEngineGuardedPrompt, type CreativeEngineImageGuardInput } from "../../shared/utils/creative-engine-image-guard.js";
import { fetchAsBuffer, resolveCropAwareCompositionHint, resolveOpenAiImageSize } from "./openai-image-technical-helpers.js";

export type OpenAiCreativeImageProviderConfig = {
  modelId?: string;
};

/** Campos do contrato de guarda do motor LEGADO (`legacy-pedro-image-guard.ts`) — nunca devem
 * chegar a este provider. Presença de qualquer um deles é sinal de que o caller confundiu qual
 * motor está chamando; falha alto e explícito em vez de aplicar a guarda errada silenciosamente. */
const LEGACY_GUARD_CONTEXT_KEYS = [
  "authorizedVisibleTitle",
  "authorizedBrandColors",
  "referenceProductFidelity",
  "authorizedCleanZones",
  "authorizedBackgroundOnly",
] as const;

/**
 * Provider de imagem do motor GPT (novo) — migração "GPT como motor criativo único" (PR 2/9).
 * Espelha a mecânica técnica de `OpenAiIcaroImageProvider` (mesmo `AiMediaProviderAdapterPort`,
 * mesmo mapeamento de tamanho/enquadramento), mas usa `creativeEngineImageGuard` em vez da guarda
 * do Pedro — nunca suprime ou reinterpreta headline/CTA/conceito/layout/direção de arte do
 * `creative_plan`, só protege fatos/assets/marca/formato/elementos proibidos.
 *
 * A escolha de guarda é sempre explícita pela classe instanciada (esta = guarda nova; nunca a do
 * Pedro), nunca inferida — por isso este provider REJEITA a requisição se qualquer campo do
 * contrato do motor legado aparecer no contexto, em vez de simplesmente ignorá-lo.
 */
export class OpenAiCreativeImageProvider implements AIProviderPort {
  readonly profile: AIProviderProfile;

  constructor(
    private readonly mediaProvider: AiMediaProviderAdapterPort,
    private readonly config: OpenAiCreativeImageProviderConfig = {},
  ) {
    const modelId = config.modelId ?? "gpt-image-1";
    this.profile = {
      id: "openai-creative-image",
      name: "OpenAI (imagem, motor criativo GPT)",
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
      throw new Error(`OpenAiCreativeImageProvider só suporta "image_generation" — recebeu "${request.taskType}".`);
    }

    const legacyKey = LEGACY_GUARD_CONTEXT_KEYS.find((key) => request.context?.[key] !== undefined);
    if (legacyKey) {
      throw new Error(
        `CREATIVE_ENGINE_LEGACY_GUARD_CONTEXT_FORBIDDEN: campo "${legacyKey}" pertence ao contrato de guarda do motor legado (Pedro) — o motor GPT usa "context.creativeGuard", nunca esse contrato. Escolha de guarda é sempre explícita, nunca inferida.`,
      );
    }

    const creativeGuard = request.context?.creativeGuard as CreativeEngineImageGuardInput | undefined;
    if (!creativeGuard) {
      throw new Error(
        "CREATIVE_ENGINE_GUARD_MISSING: OpenAiCreativeImageProvider exige request.context.creativeGuard — nunca gera imagem sem a guarda factual mínima do motor GPT.",
      );
    }

    const tenantId = typeof request.context?.clientId === "string" ? request.context.clientId : "unknown-tenant";
    const workspaceId = typeof request.context?.workspaceId === "string" ? request.context.workspaceId : undefined;
    const imageCount = typeof request.context?.imageCount === "number" && request.context.imageCount > 0 ? request.context.imageCount : 1;
    const modelId = request.model || this.profile.models[0].id;
    const imageAspectRatio = typeof request.context?.imageAspectRatio === "string" ? request.context.imageAspectRatio : undefined;
    const size = resolveOpenAiImageSize(imageAspectRatio);

    const finalPrompt = buildCreativeEngineGuardedPrompt(request.prompt, {
      ...creativeGuard,
      aspectRatio: creativeGuard.aspectRatio ?? imageAspectRatio,
      cropAwareHint: creativeGuard.cropAwareHint ?? resolveCropAwareCompositionHint(imageAspectRatio, size),
    });

    // Mesma técnica do motor legado: baixa a foto de referência uma vez, best-effort — se falhar,
    // segue com geração só-texto em vez de travar a peça inteira por causa da referência.
    const referenceImageUrl = typeof request.context?.referenceImageUrl === "string" ? request.context.referenceImageUrl.trim() : undefined;
    const referenceImageBuffer = referenceImageUrl ? await fetchAsBuffer(referenceImageUrl).catch(() => undefined) : undefined;

    const images: Array<{ uri: string; mimeType: string }> = [];
    for (let index = 0; index < imageCount; index += 1) {
      const result = await this.mediaProvider.generate({
        operationTypeCode: "image_generation",
        modelId,
        prompt: finalPrompt,
        tenantId,
        workspaceId,
        params: { size, quality: "high", targetAspectRatio: imageAspectRatio, ...(referenceImageBuffer ? { referenceImageBuffer } : {}) },
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
