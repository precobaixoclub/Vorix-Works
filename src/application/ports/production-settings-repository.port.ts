import type { ProductionSettings } from "../../shared/utils/production-settings.types.js";

/**
 * Contrato de persistência do Prompt de Produção / Diretrizes Criativas — 1 registro por
 * workspace, mesmo padrão de `BrandVisualProfileRepositoryPort`. Adapters:
 * `InMemoryProductionSettingsRepository` (dev/teste) e `PostgresProductionSettingsRepository`
 * (produção, `db/migrations/0065_workspace_production_settings.sql`).
 */
export type ProductionSettingsRepositoryPort = {
  getByWorkspace(workspaceId: string): Promise<ProductionSettings | undefined>;
  /** Cria se não existir (com `version: 1`); se já existir, faz merge parcial dos campos
   * informados em `patch` e incrementa `version` em 1 — nunca reseta `version` nem sobrescreve
   * campos ausentes do patch. */
  upsert(workspaceId: string, patch: Partial<Omit<ProductionSettings, "workspaceId" | "version" | "createdAt" | "updatedAt">>): Promise<ProductionSettings>;
};
