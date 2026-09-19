import type { InboxContactRepositoryPort, UpsertInboxContactInput } from "../../application/ports/inbox-contact-repository.port.js";
import type { InboxContact, InboxMediaStorageRef } from "../../domain/inbox/inbox.model.js";

const idGenerator = () => `contact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryInboxContactRepository implements InboxContactRepositoryPort {
  private readonly rows = new Map<string, InboxContact>();

  async upsertByPhone(input: UpsertInboxContactInput): Promise<InboxContact> {
    const existing = await this.findByPhone(input);
    const now = new Date().toISOString();
    // Mesmo conflito de identidade que o adapter Postgres detecta via unique index (migration
    // 0116) — nunca funde automaticamente: se o alias já pertence a OUTRO contato deste workspace,
    // registra o conflito e ignora o alias desta chamada (telefone continua a identidade canônica).
    if (input.whatsappPn && (await this.findByAlias(input.tenantId, input.workspaceId, "whatsappPn", input.whatsappPn, existing?.id))) {
      console.warn(`[inbox] CONFLITO DE IDENTIDADE: whatsappPn "${input.whatsappPn}" já pertence a outro contato — não fundido automaticamente.`);
      input = { ...input, whatsappPn: undefined };
    }
    if (input.whatsappLid && (await this.findByAlias(input.tenantId, input.workspaceId, "whatsappLid", input.whatsappLid, existing?.id))) {
      console.warn(`[inbox] CONFLITO DE IDENTIDADE: whatsappLid "${input.whatsappLid}" já pertence a outro contato — não fundido automaticamente.`);
      input = { ...input, whatsappLid: undefined };
    }
    if (existing) {
      const updated: InboxContact = {
        ...existing,
        name: input.name ?? existing.name,
        profilePictureUrl: input.profilePictureUrl ?? existing.profilePictureUrl,
        externalId: input.externalId ?? existing.externalId,
        metadata: input.metadata ?? existing.metadata,
        whatsappPn: input.whatsappPn ?? existing.whatsappPn,
        whatsappLid: input.whatsappLid ?? existing.whatsappLid,
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
      whatsappPn: input.whatsappPn,
      whatsappLid: input.whatsappLid,
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
      (row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && row.phoneNormalized === input.phoneNormalized && !row.mergeStatus,
    );
  }

  async updateProfilePicture(id: string, input: { storageRef: InboxMediaStorageRef; syncedAt: string }): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, { ...existing, profilePictureStorageRef: input.storageRef, profilePictureSyncedAt: input.syncedAt, updatedAt: new Date().toISOString() });
  }

  async linkCrmContact(id: string, contactId: string): Promise<InboxContact | undefined> {
    const existing = this.rows.get(id);
    if (!existing) return undefined;
    if (existing.crmContactId) return existing; // nunca sobrescreve um vínculo já existente
    const updated: InboxContact = { ...existing, crmContactId: contactId, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }

  private async findByAlias(
    tenantId: string,
    workspaceId: string,
    field: "whatsappPn" | "whatsappLid",
    value: string,
    excludeId: string | undefined,
  ): Promise<InboxContact | undefined> {
    return [...this.rows.values()].find(
      (row) => row.tenantId === tenantId && row.workspaceId === workspaceId && row[field] === value && row.id !== excludeId && !row.mergeStatus,
    );
  }
}
