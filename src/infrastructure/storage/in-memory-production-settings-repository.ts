import type { ProductionSettingsRepositoryPort } from "../../application/ports/production-settings-repository.port.js";
import { DEFAULT_PRODUCTION_SETTINGS, type ProductionSettings } from "../../shared/utils/production-settings.types.js";

export class InMemoryProductionSettingsRepository implements ProductionSettingsRepositoryPort {
  private readonly byWorkspace = new Map<string, ProductionSettings>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async getByWorkspace(workspaceId: string): Promise<ProductionSettings | undefined> {
    return this.byWorkspace.get(workspaceId);
  }

  async upsert(workspaceId: string, patch: Partial<Omit<ProductionSettings, "workspaceId" | "version" | "createdAt" | "updatedAt">>): Promise<ProductionSettings> {
    const existing = this.byWorkspace.get(workspaceId);
    const timestamp = this.now().toISOString();
    const updated: ProductionSettings = existing
      ? { ...existing, ...patch, version: existing.version + 1, updatedAt: timestamp }
      : { workspaceId, ...DEFAULT_PRODUCTION_SETTINGS, ...patch, createdAt: timestamp, updatedAt: timestamp };
    this.byWorkspace.set(workspaceId, updated);
    return updated;
  }
}
