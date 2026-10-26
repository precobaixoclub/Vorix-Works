import type { SocialAccountPatch, SocialPublishLogEntry, SocialRepositoryPort } from "../../application/ports/social-repository.port.js";
import type { SocialAccount, SocialAccountConnection, SocialBlockReason, SocialNetwork, SocialPostDestination, SocialProviderPolicy, SocialProviderSwitch, SocialProviderType } from "../../domain/social/social-publishing.model.js";

export class InMemorySocialRepository implements SocialRepositoryPort {
  private readonly accounts = new Map<string, SocialAccount>();
  private readonly policies = new Map<string, SocialProviderPolicy>();
  private readonly switches = new Map<SocialProviderType, SocialProviderSwitch>();
  private readonly destinations = new Map<string, SocialPostDestination>();
  private readonly logs = new Map<string, SocialPublishLogEntry>();
  private readonly connections = new Map<string, Map<SocialProviderType, SocialAccountConnection>>();
  private readonly dedupe = new Map<string, string>();

  async createAccount(input: Omit<SocialAccount, "createdAt" | "updatedAt" | "connections">): Promise<SocialAccount> {
    if ([...this.accounts.values()].some((account) => account.tenantId === input.tenantId && account.workspaceId === input.workspaceId && account.network === input.network && account.externalAccountId === input.externalAccountId)) {
      throw new Error("SOCIAL_ACCOUNT_DUPLICATED: conta já conectada.");
    }
    const now = new Date().toISOString();
    const account: SocialAccount = { ...input, connections: [], createdAt: now, updatedAt: now };
    this.accounts.set(account.id, account);
    return this.view(account);
  }

  /** Conta com as conexões atuais (cópia — nunca a referência interna). */
  private view(account: SocialAccount): SocialAccount {
    return { ...account, connections: [...(this.connections.get(account.id)?.values() ?? [])].map((connection) => ({ ...connection })) };
  }

  async getAccount(input: { tenantId: string; workspaceId: string; id: string }): Promise<SocialAccount | undefined> {
    const account = this.accounts.get(input.id);
    return account && account.tenantId === input.tenantId && account.workspaceId === input.workspaceId ? this.view(account) : undefined;
  }

  async findAccountByExternalId(input: { tenantId: string; workspaceId: string; network: SocialNetwork; externalAccountId: string }): Promise<SocialAccount | undefined> {
    const account = [...this.accounts.values()].find((item) => item.tenantId === input.tenantId && item.workspaceId === input.workspaceId && item.network === input.network && item.externalAccountId === input.externalAccountId);
    return account ? this.view(account) : undefined;
  }

  async listAccounts(input: { tenantId: string; workspaceId: string; network?: SocialNetwork }): Promise<SocialAccount[]> {
    return [...this.accounts.values()].filter((account) => account.tenantId === input.tenantId && account.workspaceId === input.workspaceId && (!input.network || account.network === input.network)).map((account) => this.view(account));
  }

  async updateAccount(input: { tenantId: string; id: string; patch: SocialAccountPatch }): Promise<SocialAccount | undefined> {
    const account = this.accounts.get(input.id);
    if (!account || account.tenantId !== input.tenantId) return undefined;
    const updated: SocialAccount = { ...account, ...input.patch, updatedAt: new Date().toISOString() };
    for (const key of Object.keys(input.patch) as (keyof SocialAccountPatch)[]) if (input.patch[key] === undefined) delete (updated as Record<string, unknown>)[key];
    this.accounts.set(updated.id, updated);
    return this.view(updated);
  }

  async listAccountsDueForHealthCheck(input: { olderThan: string; limit: number }): Promise<SocialAccount[]> {
    return [...this.accounts.values()]
      .filter((account) => ["CONNECTED", "HEALTHY", "TEMPORARY_ERROR"].includes(account.status) && (!account.lastHealthCheckAt || account.lastHealthCheckAt <= input.olderThan))
      .sort((left, right) => (left.lastHealthCheckAt ?? "").localeCompare(right.lastHealthCheckAt ?? ""))
      .slice(0, input.limit)
      .map((account) => this.view(account));
  }

  async listAccountsByProvider(input: { providerType: SocialProviderType; tenantId?: string }): Promise<SocialAccount[]> {
    return [...this.accounts.values()].filter((account) => this.connections.get(account.id)?.has(input.providerType) && (!input.tenantId || account.tenantId === input.tenantId)).map((account) => this.view(account));
  }

  async listTenantAccounts(input: { tenantId: string; network?: SocialNetwork }): Promise<SocialAccount[]> {
    return [...this.accounts.values()].filter((account) => account.tenantId === input.tenantId && (!input.network || account.network === input.network)).map((account) => this.view(account));
  }

  async upsertConnection(input: { tenantId: string; accountId: string; connection: Omit<SocialAccountConnection, "connectedAt" | "updatedAt"> & { connectedAt?: string } }): Promise<void> {
    const account = this.accounts.get(input.accountId);
    if (!account || account.tenantId !== input.tenantId) throw new Error("SOCIAL_ACCOUNT_NOT_FOUND: conta social não encontrada.");
    const byProvider = this.connections.get(account.id) ?? new Map<SocialProviderType, SocialAccountConnection>();
    const now = new Date().toISOString();
    const previous = byProvider.get(input.connection.providerType);
    byProvider.set(input.connection.providerType, { providerType: input.connection.providerType, credentialReferenceId: input.connection.credentialReferenceId, status: input.connection.status, connectedAt: input.connection.connectedAt ?? previous?.connectedAt ?? now, updatedAt: now });
    this.connections.set(account.id, byProvider);
  }

  async removeConnection(input: { tenantId: string; accountId: string; providerType: SocialProviderType }): Promise<void> {
    const account = this.accounts.get(input.accountId);
    if (!account || account.tenantId !== input.tenantId) return;
    this.connections.get(account.id)?.delete(input.providerType);
  }

  async getPolicy(input: { tenantId: string; network: SocialNetwork }): Promise<SocialProviderPolicy | undefined> {
    const policy = this.policies.get(`${input.tenantId}:${input.network}`);
    return policy ? structuredClone(policy) : undefined;
  }

  async listPolicies(input: { tenantId?: string }): Promise<SocialProviderPolicy[]> {
    return [...this.policies.values()].filter((policy) => !input.tenantId || policy.tenantId === input.tenantId).map((policy) => structuredClone(policy));
  }

  async upsertPolicy(input: SocialProviderPolicy): Promise<SocialProviderPolicy> {
    const saved = { ...structuredClone(input), updatedAt: input.updatedAt ?? new Date().toISOString() };
    this.policies.set(`${input.tenantId}:${input.network}`, saved);
    return structuredClone(saved);
  }

  async getSwitch(providerType: SocialProviderType): Promise<SocialProviderSwitch | undefined> {
    const item = this.switches.get(providerType);
    return item ? { ...item } : undefined;
  }

  async listSwitches(): Promise<SocialProviderSwitch[]> {
    return [...this.switches.values()].map((item) => ({ ...item }));
  }

  async upsertSwitch(input: SocialProviderSwitch): Promise<SocialProviderSwitch> {
    const saved = { ...input, updatedAt: input.updatedAt ?? new Date().toISOString() };
    this.switches.set(input.providerType, saved);
    return { ...saved };
  }

  async createDestinations(inputs: readonly Omit<SocialPostDestination, "createdAt" | "updatedAt">[]): Promise<SocialPostDestination[]> {
    const now = new Date().toISOString();
    return inputs.map((input) => {
      const destination: SocialPostDestination = { ...structuredClone(input), createdAt: now, updatedAt: now };
      this.destinations.set(destination.id, destination);
      return structuredClone(destination);
    });
  }

  async getDestinationByTarget(input: { targetId: string }): Promise<SocialPostDestination | undefined> {
    const destination = [...this.destinations.values()].find((item) => item.targetId === input.targetId);
    return destination ? structuredClone(destination) : undefined;
  }

  async getDestination(input: { tenantId: string; workspaceId: string; id: string }): Promise<SocialPostDestination | undefined> {
    const destination = this.destinations.get(input.id);
    return destination && destination.tenantId === input.tenantId && destination.workspaceId === input.workspaceId ? structuredClone(destination) : undefined;
  }

  async listDestinationsByPublication(input: { tenantId: string; workspaceId: string; publicationId: string }): Promise<SocialPostDestination[]> {
    return [...this.destinations.values()].filter((item) => item.tenantId === input.tenantId && item.workspaceId === input.workspaceId && item.publicationId === input.publicationId).map((item) => structuredClone(item));
  }

  async listDestinations(input: { tenantId: string; workspaceId: string; from?: string; to?: string; socialAccountId?: string; limit?: number }): Promise<SocialPostDestination[]> {
    return [...this.destinations.values()]
      .filter((item) => item.tenantId === input.tenantId && item.workspaceId === input.workspaceId
        && (!input.socialAccountId || item.socialAccountId === input.socialAccountId)
        && (!input.from || (item.scheduledAt ?? item.createdAt) >= input.from)
        && (!input.to || (item.scheduledAt ?? item.createdAt) <= input.to))
      .sort((left, right) => (left.scheduledAt ?? left.createdAt).localeCompare(right.scheduledAt ?? right.createdAt))
      .slice(0, input.limit ?? 500)
      .map((item) => structuredClone(item));
  }

  async listBlockedDestinations(input: { tenantId: string; socialAccountId?: string; blockReason?: SocialBlockReason; providerType?: SocialProviderType }): Promise<SocialPostDestination[]> {
    return [...this.destinations.values()].filter((item) => item.tenantId === input.tenantId && !!item.blockReason
      && (!input.socialAccountId || item.socialAccountId === input.socialAccountId)
      && (!input.blockReason || item.blockReason === input.blockReason)
      && (!input.providerType || this.accounts.get(item.socialAccountId)?.providerType === input.providerType)).map((item) => structuredClone(item));
  }

  async updateDestination(input: { tenantId: string; id: string; patch: Partial<Pick<SocialPostDestination, "blockReason" | "blockedAt" | "skippedAt" | "lastProviderType" | "lastErrorCode" | "lastErrorMessage" | "scheduledAt" | "timezone" | "caption" | "music" | "audioMode">> & { clearBlock?: boolean } }): Promise<SocialPostDestination | undefined> {
    const destination = this.destinations.get(input.id);
    if (!destination || destination.tenantId !== input.tenantId) return undefined;
    const { clearBlock, ...patch } = input.patch;
    const updated: SocialPostDestination = { ...destination, ...patch, updatedAt: new Date().toISOString() };
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) if (patch[key] === undefined) delete (updated as Record<string, unknown>)[key];
    if (clearBlock) {
      delete updated.blockReason;
      delete updated.blockedAt;
    }
    this.destinations.set(updated.id, updated);
    return structuredClone(updated);
  }

  async appendPublishLog(entry: SocialPublishLogEntry): Promise<void> {
    this.logs.set(entry.id, { ...entry });
  }

  async finishPublishLog(input: { id: string; finishedAt: string; outcome: SocialPublishLogEntry["outcome"]; errorCode?: string; durationMs?: number }): Promise<void> {
    const entry = this.logs.get(input.id);
    if (entry) this.logs.set(input.id, { ...entry, finishedAt: input.finishedAt, outcome: input.outcome, ...(input.errorCode ? { errorCode: input.errorCode } : {}), ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}) });
  }

  async countPublishLog(input: { socialAccountId: string; since: string; outcomes?: readonly NonNullable<SocialPublishLogEntry["outcome"]>[] }): Promise<number> {
    return [...this.logs.values()].filter((entry) => entry.socialAccountId === input.socialAccountId && entry.startedAt >= input.since && (!input.outcomes || (entry.outcome !== undefined && input.outcomes.includes(entry.outcome)) || entry.outcome === undefined)).length;
  }

  async lastPublishLog(input: { socialAccountId: string }): Promise<SocialPublishLogEntry | undefined> {
    return [...this.logs.values()].filter((entry) => entry.socialAccountId === input.socialAccountId).sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  }

  async listPublishLog(input: { tenantId?: string; since: string; limit?: number }): Promise<SocialPublishLogEntry[]> {
    return [...this.logs.values()].filter((entry) => (!input.tenantId || entry.tenantId === input.tenantId) && entry.startedAt >= input.since).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, input.limit ?? 1000);
  }

  async claimNotification(input: { tenantId: string; dedupeKey: string; now: string; windowMs: number }): Promise<boolean> {
    const key = `${input.tenantId}:${input.dedupeKey}`;
    const last = this.dedupe.get(key);
    if (last && Date.parse(input.now) - Date.parse(last) < input.windowMs) return false;
    this.dedupe.set(key, input.now);
    return true;
  }
}
