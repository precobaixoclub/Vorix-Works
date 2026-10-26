import type {
  SocialAccount,
  SocialAccountConnection,
  SocialBlockReason,
  SocialNetwork,
  SocialPostDestination,
  SocialProviderPolicy,
  SocialProviderSwitch,
  SocialProviderType,
} from "../../domain/social/social-publishing.model.js";

export type SocialPublishLogEntry = {
  id: string;
  tenantId: string;
  workspaceId: string;
  socialAccountId: string;
  publicationId: string;
  targetId: string;
  providerType: SocialProviderType;
  network: SocialNetwork;
  format: string;
  startedAt: string;
  finishedAt?: string;
  outcome?: "published" | "failed" | "unknown" | "deferred";
  errorCode?: string;
  durationMs?: number;
  mediaBytes?: number;
};

export type SocialAccountPatch = Partial<Pick<SocialAccount,
  "providerType" | "username" | "displayName" | "avatarUrl" | "status"
  | "accountCapabilities" | "metadata" | "consecutiveFailures" | "connectedAt" | "lastHealthCheckAt" | "lastSuccessfulPublishAt" | "reauthRequiredAt" | "lastErrorCode" | "lastErrorAt">>;

/**
 * Persistência do Social Publishing. Toda leitura/escrita por conta exige tenantId (e workspace
 * quando aplicável): isolamento aplicado no backend, nunca só no frontend.
 */
export type SocialRepositoryPort = {
  // Contas
  createAccount(input: Omit<SocialAccount, "createdAt" | "updatedAt" | "connections">): Promise<SocialAccount>;
  getAccount(input: { tenantId: string; workspaceId: string; id: string }): Promise<SocialAccount | undefined>;
  findAccountByExternalId(input: { tenantId: string; workspaceId: string; network: SocialNetwork; externalAccountId: string }): Promise<SocialAccount | undefined>;
  listAccounts(input: { tenantId: string; workspaceId: string; network?: SocialNetwork }): Promise<SocialAccount[]>;
  updateAccount(input: { tenantId: string; id: string; patch: SocialAccountPatch }): Promise<SocialAccount | undefined>;
  /** Para o health check periódico (todas as contas ativas, qualquer tenant). */
  listAccountsDueForHealthCheck(input: { olderThan: string; limit: number }): Promise<SocialAccount[]>;
  listAccountsByProvider(input: { providerType: SocialProviderType; tenantId?: string }): Promise<SocialAccount[]>;
  /** Contas da rede no tenant (todas as workspaces) — usada pela migração de provider. */
  listTenantAccounts(input: { tenantId: string; network?: SocialNetwork }): Promise<SocialAccount[]>;

  // Conexões conta ↔ provider (a credencial em si fica no cofre central)
  upsertConnection(input: { tenantId: string; accountId: string; connection: Omit<SocialAccountConnection, "connectedAt" | "updatedAt"> & { connectedAt?: string } }): Promise<void>;
  removeConnection(input: { tenantId: string; accountId: string; providerType: SocialProviderType }): Promise<void>;

  // Política por tenant e chaves globais
  getPolicy(input: { tenantId: string; network: SocialNetwork }): Promise<SocialProviderPolicy | undefined>;
  listPolicies(input: { tenantId?: string }): Promise<SocialProviderPolicy[]>;
  upsertPolicy(input: SocialProviderPolicy): Promise<SocialProviderPolicy>;
  getSwitch(providerType: SocialProviderType): Promise<SocialProviderSwitch | undefined>;
  listSwitches(): Promise<SocialProviderSwitch[]>;
  upsertSwitch(input: SocialProviderSwitch): Promise<SocialProviderSwitch>;

  // Destinos
  createDestinations(inputs: readonly Omit<SocialPostDestination, "createdAt" | "updatedAt">[]): Promise<SocialPostDestination[]>;
  getDestinationByTarget(input: { targetId: string }): Promise<SocialPostDestination | undefined>;
  getDestination(input: { tenantId: string; workspaceId: string; id: string }): Promise<SocialPostDestination | undefined>;
  listDestinationsByPublication(input: { tenantId: string; workspaceId: string; publicationId: string }): Promise<SocialPostDestination[]>;
  listDestinations(input: { tenantId: string; workspaceId: string; from?: string; to?: string; socialAccountId?: string; limit?: number }): Promise<SocialPostDestination[]>;
  listBlockedDestinations(input: { tenantId: string; socialAccountId?: string; blockReason?: SocialBlockReason; providerType?: SocialProviderType }): Promise<SocialPostDestination[]>;
  updateDestination(input: { tenantId: string; id: string; patch: Partial<Pick<SocialPostDestination, "blockReason" | "blockedAt" | "skippedAt" | "lastProviderType" | "lastErrorCode" | "lastErrorMessage" | "scheduledAt" | "timezone" | "caption" | "music" | "audioMode">> & { clearBlock?: boolean } }): Promise<SocialPostDestination | undefined>;

  // Log operacional (limites, métricas, custo)
  appendPublishLog(entry: SocialPublishLogEntry): Promise<void>;
  finishPublishLog(input: { id: string; finishedAt: string; outcome: SocialPublishLogEntry["outcome"]; errorCode?: string; durationMs?: number }): Promise<void>;
  countPublishLog(input: { socialAccountId: string; since: string; outcomes?: readonly NonNullable<SocialPublishLogEntry["outcome"]>[] }): Promise<number>;
  lastPublishLog(input: { socialAccountId: string }): Promise<SocialPublishLogEntry | undefined>;
  listPublishLog(input: { tenantId?: string; since: string; limit?: number }): Promise<SocialPublishLogEntry[]>;

  // Dedupe de notificações
  claimNotification(input: { tenantId: string; dedupeKey: string; now: string; windowMs: number }): Promise<boolean>;
};
