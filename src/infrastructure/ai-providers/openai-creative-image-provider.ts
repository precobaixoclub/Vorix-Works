import type { AIProviderPort, AIProviderProfile, AIProviderRequest, AIProviderResponse } from "../../application/ports/ai-provider.port.js";
import type { AiMediaProviderAdapterPort } from "../../application/ports/ai-media-provider-adapter.port.js";
import { buildCreativeEngineGuardedPrompt, type CreativeEngineImageGuardInput } from "../../shared/utils/creative-engine-image-guard.js";
import { fetchAsBuffer, resolveCropAwareCompositionHint, throwMediaGenerationFailure } from "./openai-image-technical-helpers.js";
import {
  DEFAULT_GPT_IMAGE_FAST_MODEL,
  DEFAULT_GPT_IMAGE_MODEL,
  DEFAULT_GPT_IMAGE_QUALITY,
  getGptImageModel,
  resolveGptImageCanvas,
  unsupportedGptImageModelMessage,
  type GptImageComplexity,
  type GptImageQuality,
} from "../../shared/utils/gpt-image-models.js";

export type OpenAiCreativeImageProviderConfig = {
  /** Modelo principal (peças exigentes) — vem de `OPENAI_IMAGE_MODEL`. */
  modelId?: string;
  /** Modelo rápido (`context.imageModelTier === "fast"`) — vem de `OPENAI_IMAGE_FAST_MODEL`. */
  fastModelId?: string;
  /** Qualidade da geração — vem de `OPENAI_IMAGE_QUALITY` (padrão "high"). */
  quality?: GptImageQuality;
  /** `complexity` da família 2.6 — vem de `OPENAI_IMAGE_COMPLEXITY`; omitido = padrão do modelo. */
  complexity?: GptImageComplexity;
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
    const modelId = config.modelId ?? DEFAULT_GPT_IMAGE_MODEL;
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
    // Modelo: o pedido explícito do Ícaro, senão o do nível pedido (rápido/principal) da configuração.
    const fastTier = request.context?.imageModelTier === "fast";
    const modelId = request.model || (fastTier ? this.config.fastModelId ?? DEFAULT_GPT_IMAGE_FAST_MODEL : this.profile.models[0].id);
    const modelSpec = getGptImageModel(modelId);
    if (!modelSpec) throwMediaGenerationFailure("invalid_request", unsupportedGptImageModelMessage(modelId));
    const imageAspectRatio = typeof request.context?.imageAspectRatio === "string" ? request.context.imageAspectRatio : undefined;
    // Canvas na proporção EXATA da peça quando o modelo aceita tamanho livre (nada é cortado depois).
    const canvas = resolveGptImageCanvas(modelSpec!, imageAspectRatio);
    const size = canvas.size;
    const quality = this.config.quality ?? DEFAULT_GPT_IMAGE_QUALITY;

    const finalPrompt = buildCreativeEngineGuardedPrompt(request.prompt, {
      ...creativeGuard,
      aspectRatio: creativeGuard.aspectRatio ?? imageAspectRatio,
      // Aviso de corte só quando o corte vai mesmo acontecer (canvas fora da proporção pedida).
      cropAwareHint: creativeGuard.cropAwareHint ?? (canvas.exact ? undefined : resolveCropAwareCompositionHint(imageAspectRatio, size)),
    });

    // Referências reais (principal + variações). Auditoria 25/11/2026: antes era uma única URL baixada
    // "best-effort" — se falhasse, a peça saía só por texto, sem aviso, e o produto era inventado.
    // Quando a referência é obrigatória (`referenceRequired`, produto/tela que a peça anuncia), a falha
    // agora interrompe a geração com motivo explícito; sem a marca, mantém o comportamento anterior.
    const referenceImageUrl = typeof request.context?.referenceImageUrl === "string" ? request.context.referenceImageUrl.trim() : undefined;
    const extraReferenceUrls = Array.isArray(request.context?.referenceImageUrls)
      ? (request.context.referenceImageUrls as unknown[]).filter((url): url is string => typeof url === "string" && url.trim().length > 0 && url.trim() !== referenceImageUrl).slice(0, 4)
      : [];
    const referenceRequired = request.context?.referenceRequired === true;
    const fetchReference = async (url: string) => {
      try {
        return await fetchAsBuffer(url);
      } catch (error) {
        if (referenceRequired) {
          throwMediaGenerationFailure("invalid_request", `REFERENCE_IMAGE_UNAVAILABLE: a referência obrigatória não pôde ser carregada (${error instanceof Error ? error.message : "erro desconhecido"}) — a peça não é gerada sem ela.`);
        }
        return undefined;
      }
    };
    const referenceImageBuffer = referenceImageUrl ? await fetchReference(referenceImageUrl) : undefined;
    const referenceImageBuffers = (await Promise.all(extraReferenceUrls.map(fetchReference))).filter((buffer): buffer is Buffer => Boolean(buffer));
    // Fundo explícito só quando o motor pede (ex.: base institucional editorial = "opaque").
    // Sem isso a OpenAI usa "auto" e pode devolver PNG com transparência (achado do cenário B).
    const background = request.context?.imageBackground === "opaque" || request.context?.imageBackground === "transparent" || request.context?.imageBackground === "auto" ? request.context.imageBackground : undefined;

    const images: Array<{ uri: string; mimeType: string }> = [];
    const audits: NonNullable<Extract<Awaited<ReturnType<AiMediaProviderAdapterPort["generate"]>>, { ok: true }>["audit"]>[] = [];
    for (let index = 0; index < imageCount; index += 1) {
      const result = await this.mediaProvider.generate({
        operationTypeCode: "image_generation",
        modelId,
        prompt: finalPrompt,
        tenantId,
        workspaceId,
        params: {
          size,
          quality,
          ...(this.config.complexity ? { complexity: this.config.complexity } : {}),
          targetAspectRatio: imageAspectRatio,
          ...(referenceImageBuffer ? { referenceImageBuffer } : {}),
          ...(referenceImageBuffers.length ? { referenceImageBuffers } : {}),
          ...(background ? { background } : {}),
        },
        timeoutMs: request.timeoutMs,
      });
      if (!result.ok) {
        throwMediaGenerationFailure(result.category, result.message);
      }
      images.push({ uri: result.mediaUrl, mimeType: "image/png" });
      if (result.audit) audits.push(result.audit);
    }

    // Custo e tokens REAIS: somados do `usage` que a OpenAI devolve em cada imagem (preço oficial
    // do catálogo). Sem `usage` numa resposta, aquela imagem entra com custo 0 e a auditoria
    // (`imageAudit`) mostra que o consumo não foi informado — nunca um número inventado.
    const totals = audits.reduce(
      (acc, audit) => ({
        input: acc.input + (audit.usage ? audit.usage.inputTextTokens + audit.usage.inputImageTokens : 0),
        output: acc.output + (audit.usage ? audit.usage.outputImageTokens + audit.usage.outputTextTokens : 0),
        cost: acc.cost + (audit.costUsd ?? 0),
      }),
      { input: 0, output: 0, cost: 0 },
    );

    return {
      content: JSON.stringify({
        images,
        imageAudit: { model: modelId, canvas: { size, width: canvas.width, height: canvas.height, exact: canvas.exact }, quality, complexity: this.config.complexity ?? "padrão do modelo", calls: audits },
      }),
      model: modelId,
      tokens: { input: totals.input, output: totals.output, total: totals.input + totals.output },
      cost: { estimated: Math.round(totals.cost * 1_000_000) / 1_000_000, currency: "USD" },
    };
  }
}
