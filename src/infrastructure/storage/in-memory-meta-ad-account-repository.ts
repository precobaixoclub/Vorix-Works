import type { MetaAdAccount, MetaAdAccountRepositoryPort, UpsertMetaAdAccountInput } from "../../application/ports/meta-ad-account-repository.port.js";

function buildId(workspaceId: string, credentialReferenceId: string, accountId: string): string {
  return `maa-${workspaceId}-${credentialReferenceId}-${accountId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class InMemoryMetaAdAccountRepository implements MetaAdAccountRepositoryPort {
  private readonly accounts = new Map<string, MetaAdAccount>();

  async upsertAccount(input: UpsertMetaAdAccountInput): Promise<MetaAdAccount> {
    const id = input.id ?? buildId(input.workspaceId, input.credentialReferenceId, input.accountId);
    const now = new Date().toISOString();
    const existing = this.accounts.get(id);
    const record: MetaAdAccount = { ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now, lastSyncedAt: now };
    this.accounts.set(id, record);
    return record;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MetaAdAccount[]> {
    return [...this.accounts.values()]
      .filter((account) => account.tenantId === input.tenantId && account.workspaceId === input.workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getById(id: string): Promise<MetaAdAccount | undefined> {
    return this.accounts.get(id);
  }

  async listAllActive(): Promise<MetaAdAccount[]> {
    return [...this.accounts.values()].filter((account) => account.isActive);
  }

  async deactivateMissing(input: { credentialReferenceId: string; keepAccountIds: readonly string[] }): Promise<void> {
    const keep = new Set(input.keepAccountIds);
    for (const [id, account] of this.accounts) {
      if (account.credentialReferenceId !== input.credentialReferenceId) continue;
      if (keep.has(account.accountId)) continue;
      this.accounts.set(id, { ...account, isActive: false, updatedAt: new Date().toISOString() });
    }
  }
}
