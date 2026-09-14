import type { InboxIdentityLink, InboxIdentityLinkRepositoryPort, UpsertInboxIdentityLinkInput } from "../../application/ports/inbox-identity-link-repository.port.js";

const idGenerator = () => `inboxlink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryInboxIdentityLinkRepository implements InboxIdentityLinkRepositoryPort {
  private readonly rows = new Map<string, InboxIdentityLink>();

  private key(workspaceId: string, lid: string): string {
    return `${workspaceId}:${lid}`;
  }

  async upsert(input: UpsertInboxIdentityLinkInput): Promise<InboxIdentityLink> {
    const key = this.key(input.workspaceId, input.lid);
    const existing = this.rows.get(key);
    const now = new Date().toISOString();
    const updated: InboxIdentityLink = {
      id: existing?.id ?? idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      lid: input.lid,
      phoneE164: input.phoneE164,
      confidence: Math.max(existing?.confidence ?? 0, input.confidence),
      source: input.source,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(key, updated);
    return updated;
  }

  async getByLid(workspaceId: string, lid: string): Promise<InboxIdentityLink | undefined> {
    return this.rows.get(this.key(workspaceId, lid));
  }

  async listByPhone(workspaceId: string, phoneE164: string): Promise<InboxIdentityLink[]> {
    return [...this.rows.values()].filter((row) => row.workspaceId === workspaceId && row.phoneE164 === phoneE164);
  }

  async listUpdatedSince(workspaceId: string, sinceIso: string, limit: number): Promise<InboxIdentityLink[]> {
    return [...this.rows.values()]
      .filter((row) => row.workspaceId === workspaceId && row.updatedAt >= sinceIso)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, limit);
  }
}
