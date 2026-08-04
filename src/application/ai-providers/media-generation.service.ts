import type { AiModelPricing } from "../../domain/ai-providers/index.js";
import type { AiProvidersRepositoryPort } from "../ports/ai-providers-repository.port.js";
import type { AiMediaGenerationFailureCategory } from "../ports/ai-media-provider-adapter.port.js";
import type { CreditAccountingService } from "./credit-accounting.service.js";
import type { AiMediaProviderRegistry } from "./ai-media-provider-registry.js";

export type MediaGenerationDeps = {
  registry: AiMediaProviderRegistry;
  creditAccounting: CreditAccountingService;
  aiProvidersRepository: AiProvidersRepositoryPort;
  now: () => Date;
};

export type MediaGenerationRequest = {
  tenantId: string;
  workspaceId?: string;
  /** Código de `AiOperationType` — hoje `"image_generation"` ou `"video_generation"`. */
  operationTypeCode: string;
  prompt: string;
  params: Record<string, unknown>;
  userId?: string;
  timeoutMs?: number;
};

export type MediaGenerationResult =
  | { ok: true; mediaUrl: string }
  | { ok: false; category: AiMediaGenerationFailureCategory | "operation_unknown" | "quota_exceeded" | "account_blocked"; message: string };

/**
 * Entrada única para geração real de mídia (imagem/vídeo) — a "porta" que o motor de
 * Execução/Ícaro (Pedro/Rafa) chamará para produzir mídia real, em vez do modo fake/assistido
 * atual. Espelha o papel de `CreditGatedAiGateway`, mas para a pilha de mídia: crédito primeiro,
 * depois provider, depois auditoria — nunca ao contrário.
 */
export class MediaGenerationService {
  constructor(private readonly deps: MediaGenerationDeps) {}

  async generate(request: MediaGenerationRequest): Promise<MediaGenerationResult> {
    const now = this.deps.now();
    const availability = await this.deps.creditAccounting.checkAvailability(request.tenantId, request.operationTypeCode, now);
    if (!availability.ok) return { ok: false, category: availability.reason, message: availability.message };

    const operationType = availability.operationType;
    const providerCode = operationType.defaultProviderCode;
    const modelId = operationType.defaultModelId;
    if (!providerCode || !modelId) {
      return { ok: false, category: "not_configured", message: `Operação "${operationType.code}" não tem provedor/modelo padrão configurado.` };
    }

    // `registry.resolve()` só sabe o que foi ligado por variável de ambiente no deploy (capacidade
    // da instalação); o toggle "Habilitado" do painel admin (`/admin/ai-providers`) grava em
    // `ai_providers.status`, não no registry — sem checar isso aqui, desligar um provider pelo
    // painel não teria efeito nenhum em runtime (mesma classe de bug que `SettingsGatedAiGateway`
    // já resolve para o texto, checando `platform_ai_settings` a cada chamada em vez de uma flag
    // travada na construção do container).
    const providerConfig = await this.deps.aiProvidersRepository.getProvider(providerCode);
    if (!providerConfig || providerConfig.status !== "active") {
      return { ok: false, category: "not_configured", message: `Provedor "${providerCode}" está desabilitado em Provedores de IA — habilite-o no painel admin.` };
    }

    let adapter;
    try {
      adapter = this.deps.registry.resolve(providerCode);
    } catch (error) {
      return { ok: false, category: "not_configured", message: error instanceof Error ? error.message : "Provedor indisponível." };
    }

    const result = await adapter.generate({
      operationTypeCode: operationType.code,
      modelId,
      prompt: request.prompt,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      params: request.params,
      timeoutMs: request.timeoutMs ?? 60_000,
    });

    if (!result.ok) {
      try {
        await this.deps.creditAccounting.recordFailure({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          operationType,
          providerCode,
          modelId,
          errorCode: result.category,
          requestedByUserId: request.userId,
          now,
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[MediaGenerationService] Falha ao registrar geração com erro:", error);
      }
      return { ok: false, category: result.category, message: result.message };
    }

    const models = await this.deps.aiProvidersRepository.listModels(providerCode);
    const modelConfig = models.find((m) => m.modelId === modelId);
    const providerCostUsd = modelConfig ? computeProviderCostUsd(modelConfig.pricing, result.billableUnits) : 0;

    try {
      await this.deps.creditAccounting.recordSuccess({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        operationType,
        providerCode,
        modelId,
        providerCostUsd,
        monthlyRemainingBefore: availability.monthlyRemainingBefore,
        creditsExtraBefore: availability.creditsExtraBefore,
        requestedByUserId: request.userId,
        now,
      });
    } catch (error) {
      // Nunca derruba a mídia já gerada com sucesso — só loga na sombra.
      // eslint-disable-next-line no-console
      console.error("[MediaGenerationService] Falha ao registrar consumo:", error);
    }

    return { ok: true, mediaUrl: result.mediaUrl };
  }
}

function computeProviderCostUsd(pricing: AiModelPricing, billableUnits: number): number {
  if (pricing.kind === "per_image") return roundToMicroCent(pricing.usdPerImage * billableUnits);
  if (pricing.kind === "per_video_second") return roundToMicroCent(pricing.usdPerSecond * billableUnits);
  return 0;
}

function roundToMicroCent(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
