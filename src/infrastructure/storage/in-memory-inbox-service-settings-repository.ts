import type { InboxServiceSettingsRepositoryPort } from "../../application/ports/inbox-service-settings-repository.port.js";
import type { InboxServiceSettings } from "../../domain/inbox/service-settings.js";

export class InMemoryInboxServiceSettingsRepository implements InboxServiceSettingsRepositoryPort {
  private readonly items = new Map<string, InboxServiceSettings>();

  async get(workspaceId: string): Promise<InboxServiceSettings | undefined> {
    return this.items.get(workspaceId);
  }

  async upsert(settings: InboxServiceSettings): Promise<InboxServiceSettings> {
    const saved = { ...settings, updatedAt: new Date().toISOString() };
    this.items.set(settings.workspaceId, saved);
    return saved;
  }
}
