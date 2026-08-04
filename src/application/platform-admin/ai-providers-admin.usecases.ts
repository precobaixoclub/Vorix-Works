import type { AiProvidersRepositoryPort } from "../ports/ai-providers-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import type { AiMediaProviderRegistry } from "../ai-providers/ai-media-provider-registry.js";
import type { AiOperationType, AiProviderCode, AiProviderConfig, AiProviderModelConfig, AiProviderStatus } from "../../domain/ai-providers/index.js";

export type AiProvidersAdminDeps = {
  aiProvidersRepository: AiProvidersRepositoryPort;
  aiMediaProviderRegistry: AiMediaProviderRegistry;
  secretManager: SecretManagerPort;
  now: () => Date;
};

export type AiProviderAdminActor = { userId: string };

export type AiProviderOverview = AiProviderConfig & {
  models: AiProviderModelConfig[];
  hasSecretConfigured: boolean;
  health: { ok: boolean; safeMessage?: string };
};

/** Lista os provedores cadastrados com modelos e um health check ao vivo (só para os que têm
 * adapter registrado — Anthropic é `externallyManaged`, sem adapter aqui, sempre "ok"). */
export async function listAiProvidersOverview(deps: AiProvidersAdminDeps): Promise<AiProviderOverview[]> {
  const [providers, models] = await Promise.all([
    deps.aiProvidersRepository.listProviders(),
    deps.aiProvidersRepository.listModels(),
  ]);

  return Promise.all(
    providers.map(async (provider) => {
      const providerModels = models.filter((m) => m.providerCode === provider.code);
      if (provider.externallyManaged) {
        return { ...provider, models: providerModels, hasSecretConfigured: true, health: { ok: provider.status === "active" } };
      }
      try {
        const health = await deps.aiMediaProviderRegistry.health(provider.code);
        return { ...provider, models: providerModels, hasSecretConfigured: Boolean(provider.secretReference), health };
      } catch {
        return { ...provider, models: providerModels, hasSecretConfigured: Boolean(provider.secretReference), health: { ok: false, safeMessage: "Provider não registrado." } };
      }
    }),
  );
}

/** Liga/desliga um provedor (nunca mexe na chave). */
export async function setAiProviderStatus(
  deps: AiProvidersAdminDeps,
  input: { code: AiProviderCode; status: AiProviderStatus; actor: AiProviderAdminActor },
): Promise<AiProviderConfig> {
  return deps.aiProvidersRepository.updateProvider({
    code: input.code,
    patch: { status: input.status },
    now: deps.now().toISOString(),
    actorUserId: input.actor.userId,
  });
}

/** Grava a API key no cofre genérico (`operational_secrets`) e marca o provider como configurado.
 * `apiKey === ""` remove a chave (mesma convenção de `updatePlatformAiSettings`). */
export async function setAiProviderApiKey(
  deps: AiProvidersAdminDeps,
  input: { code: AiProviderCode; apiKey: string; actor: AiProviderAdminActor },
): Promise<AiProviderConfig> {
  const secretReference = `ai-provider:${input.code}`;
  if (input.apiKey === "") {
    await deps.secretManager.delete(secretReference);
    return deps.aiProvidersRepository.updateProvider({
      code: input.code,
      patch: { secretReference: undefined },
      now: deps.now().toISOString(),
      actorUserId: input.actor.userId,
    });
  }
  await deps.secretManager.put(secretReference, { value: { apiKey: input.apiKey } });
  return deps.aiProvidersRepository.updateProvider({
    code: input.code,
    patch: { secretReference },
    now: deps.now().toISOString(),
    actorUserId: input.actor.userId,
  });
}

export async function listAiOperationTypes(deps: AiProvidersAdminDeps): Promise<AiOperationType[]> {
  return deps.aiProvidersRepository.listOperationTypes();
}

/** Único ponto que muda "quanto custa em crédito fazer X" — nunca calculado por proximidade de
 * custo real, sempre um número fixo escolhido pelo admin. */
export async function updateAiOperationTypeCredits(
  deps: AiProvidersAdminDeps,
  input: { code: string; creditsCost?: number; active?: boolean; actor: AiProviderAdminActor },
): Promise<AiOperationType> {
  if (input.creditsCost !== undefined && input.creditsCost < 0) {
    throw new Error("AI_OPERATION_TYPE_INVALID_CREDITS: creditsCost não pode ser negativo.");
  }
  return deps.aiProvidersRepository.updateOperationType({
    code: input.code,
    patch: { creditsCost: input.creditsCost, active: input.active },
    now: deps.now().toISOString(),
  });
}

export type AiProvidersFinanceSummary = {
  periodStart: string;
  periodEnd: string;
  byProvider: Array<{
    providerCode: AiProviderCode;
    totalCreditsConsumed: number;
    totalProviderCostUsd: number;
    totalEstimatedRevenueUsd: number;
    totalProfitUsd: number;
    totalGenerations: number;
  }>;
  totals: { creditsConsumed: number; providerCostUsd: number; estimatedRevenueUsd: number; profitUsd: number; generations: number };
};

/** Painel financeiro: gasto/receita/lucro por provedor num período — a auditoria que o pedido
 * original descreveu ("quanto gastamos com cada provedor, quanto arrecadamos, qual o lucro"). */
export async function getAiProvidersFinanceSummary(
  deps: AiProvidersAdminDeps,
  input: { periodStart: string; periodEnd: string },
): Promise<AiProvidersFinanceSummary> {
  const byProvider = await deps.aiProvidersRepository.aggregateGenerationsByProvider(input);
  const withProfit = byProvider.map((row) => ({ ...row, totalProfitUsd: Math.max(0, row.totalEstimatedRevenueUsd - row.totalProviderCostUsd) }));
  const totals = withProfit.reduce(
    (acc, row) => ({
      creditsConsumed: acc.creditsConsumed + row.totalCreditsConsumed,
      providerCostUsd: acc.providerCostUsd + row.totalProviderCostUsd,
      estimatedRevenueUsd: acc.estimatedRevenueUsd + row.totalEstimatedRevenueUsd,
      profitUsd: acc.profitUsd + row.totalProfitUsd,
      generations: acc.generations + row.totalGenerations,
    }),
    { creditsConsumed: 0, providerCostUsd: 0, estimatedRevenueUsd: 0, profitUsd: 0, generations: 0 },
  );
  return { periodStart: input.periodStart, periodEnd: input.periodEnd, byProvider: withProfit, totals };
}
