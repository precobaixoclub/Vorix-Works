import type { InboxContactRepositoryPort, UpsertInboxContactInput } from "../../application/ports/inbox-contact-repository.port.js";
import type { InboxContact } from "../../domain/inbox/inbox.model.js";

const idGenerator = () => `contact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryInboxContactRepository implements InboxContactRepositoryPort {
  private readonly rows = new Map<string, InboxContact>();

  async upsertByPhone(input: UpsertInboxContactInput): Promise<InboxContact> {
    const existing = await this.findByPhone(input);
    const now = new Date().toISOString();
    if (existing) {
      const updated: InboxContact = {
        ...existing,
        name: input.name ?? existing.name,
        profilePictureUrl: input.profilePictureUrl ?? existing.profilePictureUrl,
        externalId: input.externalId ?? existing.externalId,
        metadata: input.metadata ?? existing.metadata,
        updatedAt: now,
      };
      this.rows.set(updated.id, updated);
      return updated;
    }
    const created: InboxContact = {
      id: idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      phoneNormalized: input.phoneNormalized,
      name: input.name,
      profilePictureUrl: input.profilePictureUrl,
      externalId: input.externalId,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(created.id, created);
    return created;
  }

  async getById(id: string): Promise<InboxContact | undefined> {
    return this.rows.get(id);
  }

  async findByPhone(input: { tenantId: string; workspaceId: string; phoneNormalized: string }): Promise<InboxContact | undefined> {
    return [...this.rows.values()].find(
      (row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && row.phoneNormalized === input.phoneNormalized,
    );
  }
}
