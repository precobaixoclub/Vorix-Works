import type {
  AiGenerationLedgerEntry,
  AiOperationType,
  AiProviderCode,
  AiProviderConfig,
  AiProviderModelConfig,
} from "../../domain/ai-providers/index.js";

/**
 * Porta de persistência do bounded context `ai-providers` — cadastro de provedores/modelos,
 * catálogo de operações que consomem crédito, e o ledger de geração (auditoria financeira).
 * Adapter concreto: `PostgresAiProvidersRepository`. Nenhuma regra de negócio aqui.
 */
export type AiProvidersRepositoryPort = {
  listProviders(): Promise<AiProviderConfig[]>;
  getProvider(code: AiProviderCode): Promise<AiProviderConfig | undefined>;
  updateProvider(input: {
    code: AiProviderCode;
    patch: Partial<Pick<AiProviderConfig, "status" | "secretReference" | "baseUrl" | "defaultParams">>;
    now: string;
    actorUserId?: string;
  }): Promise<AiProviderConfig>;

  listModels(providerCode?: AiProviderCode): Promise<AiProviderModelConfig[]>;
  updateModel(input: {
    id: string;
    patch: Partial<Pick<AiProviderModelConfig, "active" | "pricing">>;
    now: string;
  }): Promise<AiProviderModelConfig>;

  listOperationTypes(): Promise<AiOperationType[]>;
  getOperationType(code: string): Promise<AiOperationType | undefined>;
  updateOperationType(input: {
    code: string;
    patch: Partial<Pick<AiOperationType, "creditsCost" | "active" | "defaultProviderCode" | "defaultModelId">>;
    now: string;
  }): Promise<AiOperationType>;

  /** Grava uma linha por geração — nunca atualizada depois de inserida (auditoria imutável). */
  recordGeneration(entry: Omit<AiGenerationLedgerEntry, "id"> & { id: string }): Promise<AiGenerationLedgerEntry>;

  listGenerations(input: { tenantId: string; limit?: number }): Promise<AiGenerationLedgerEntry[]>;

  /** Agregado para o painel financeiro: gasto/receita por provedor num período. */
  aggregateGenerationsByProvider(input: { periodStart: string; periodEnd: string }): Promise<
    Array<{
      providerCode: AiProviderCode;
      totalCreditsConsumed: number;
      totalProviderCostUsd: number;
      totalEstimatedRevenueUsd: number;
      totalGenerations: number;
    }>
  >;
};
