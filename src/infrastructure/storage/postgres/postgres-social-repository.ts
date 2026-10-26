import type { Pool } from "pg";
import type { SocialAccountPatch, SocialPublishLogEntry, SocialRepositoryPort } from "../../../application/ports/social-repository.port.js";
import {
  DEFAULT_LATE_POLICY,
  DEFAULT_RATE_LIMITS,
  type SocialAccount,
  type SocialAccountConnection,
  type SocialBlockReason,
  type SocialNetwork,
  type SocialPostDestination,
  type SocialProviderPolicy,
  type SocialProviderSwitch,
  type SocialProviderType,
} from "../../../domain/social/social-publishing.model.js";

type AccountRow = {
  id: string; tenant_id: string; workspace_id: string; network: string; provider_type: string; external_account_id: string; username: string | null; display_name: string | null; avatar_url: string | null;
  status: string; account_capabilities: SocialAccount["accountCapabilities"]; metadata: Record<string, unknown>;
  consecutive_failures: number; connected_at: Date | null; last_health_check_at: Date | null; last_successful_publish_at: Date | null; reauth_required_at: Date | null; last_error_code: string | null; last_error_at: Date | null;
  created_by: string; created_at: Date; updated_at: Date;
};
type PolicyRow = { tenant_id: string; network: string; publishing_enabled: boolean; preferred_provider: string; enabled_providers: string[]; late_policy: Partial<SocialProviderPolicy["latePolicy"]>; rate_limits: Partial<SocialProviderPolicy["rateLimits"]>; updated_by: string | null; updated_at: Date };
type ConnectionRow = { social_account_id: string; provider_type: string; credential_reference_id: string; status: string; connected_at: Date; updated_at: Date };
type SwitchRow = { provider_type: string; enabled: boolean; approved: boolean; reason: string | null; updated_by: string | null; updated_at: Date };
type DestinationRow = {
  id: string; tenant_id: string; workspace_id: string; publication_id: string; target_id: string; social_account_id: string; network: string; format: string; caption: string; hashtags: string[];
  music: SocialPostDestination["music"] | null; audio_mode: string; media: SocialPostDestination["media"]; scheduled_at: Date | null; timezone: string | null; block_reason: string | null; blocked_at: Date | null; skipped_at: Date | null;
  last_provider_type: string | null; last_error_code: string | null; last_error_message: string | null; created_by: string; created_at: Date; updated_at: Date;
};
type LogRow = { id: string; tenant_id: string; workspace_id: string; social_account_id: string; publication_id: string; target_id: string; provider_type: string; network: string; format: string; started_at: Date; finished_at: Date | null; outcome: string | null; error_code: string | null; duration_ms: number | null; media_bytes: string | null };
const ACCOUNT_COLUMNS: Record<keyof SocialAccountPatch, string> = {
  providerType: "provider_type",
  username: "username",
  displayName: "display_name",
  avatarUrl: "avatar_url",
  status: "status",
  accountCapabilities: "account_capabilities",
  metadata: "metadata",
  consecutiveFailures: "consecutive_failures",
  connectedAt: "connected_at",
  lastHealthCheckAt: "last_health_check_at",
  lastSuccessfulPublishAt: "last_successful_publish_at",
  reauthRequiredAt: "reauth_required_at",
  lastErrorCode: "last_error_code",
  lastErrorAt: "last_error_at",
};

const DESTINATION_COLUMNS = {
  blockReason: "block_reason",
  blockedAt: "blocked_at",
  skippedAt: "skipped_at",
  lastProviderType: "last_provider_type",
  lastErrorCode: "last_error_code",
  lastErrorMessage: "last_error_message",
  scheduledAt: "scheduled_at",
  timezone: "timezone",
  caption: "caption",
  music: "music",
  audioMode: "audio_mode",
} as const;

const JSON_COLUMNS = new Set(["account_capabilities", "metadata", "music"]);

export class PostgresSocialRepository implements SocialRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createAccount(input: Omit<SocialAccount, "createdAt" | "updatedAt" | "connections">): Promise<SocialAccount> {
    const result = await this.pool.query<AccountRow>(
      `insert into social_accounts (id, tenant_id, workspace_id, network, provider_type, external_account_id, username, display_name, avatar_url, status, account_capabilities, metadata, consecutive_failures, connected_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [input.id, input.tenantId, input.workspaceId, input.network, input.providerType, input.externalAccountId, input.username ?? null, input.displayName ?? null, input.avatarUrl ?? null, input.status, JSON.stringify(input.accountCapabilities ?? {}), JSON.stringify(input.metadata ?? {}), input.consecutiveFailures, input.connectedAt ?? null, input.createdBy],
    );
    return (await this.withConnections(result.rows))[0]!;
  }

  /** Anexa as conexões por provider (uma consulta para o lote, não uma por conta). */
  private async withConnections(rows: readonly AccountRow[]): Promise<SocialAccount[]> {
    if (rows.length === 0) return [];
    const result = await this.pool.query<ConnectionRow>("select * from social_account_connections where social_account_id = any($1::text[]) order by provider_type", [rows.map((row) => row.id)]);
    const byAccount = new Map<string, SocialAccountConnection[]>();
    for (const row of result.rows) byAccount.set(row.social_account_id, [...(byAccount.get(row.social_account_id) ?? []), toConnection(row)]);
    return rows.map((row) => toAccount(row, byAccount.get(row.id) ?? []));
  }

  async getAccount(input: { tenantId: string; workspaceId: string; id: string }): Promise<SocialAccount | undefined> {
    const result = await this.pool.query<AccountRow>("select * from social_accounts where id = $1 and tenant_id = $2 and workspace_id = $3", [input.id, input.tenantId, input.workspaceId]);
    return (await this.withConnections(result.rows))[0];
  }

  async findAccountByExternalId(input: { tenantId: string; workspaceId: string; network: SocialNetwork; externalAccountId: string }): Promise<SocialAccount | undefined> {
    const result = await this.pool.query<AccountRow>("select * from social_accounts where tenant_id = $1 and workspace_id = $2 and network = $3 and external_account_id = $4", [input.tenantId, input.workspaceId, input.network, input.externalAccountId]);
    return (await this.withConnections(result.rows))[0];
  }

  async listAccounts(input: { tenantId: string; workspaceId: string; network?: SocialNetwork }): Promise<SocialAccount[]> {
    const result = await this.pool.query<AccountRow>("select * from social_accounts where tenant_id = $1 and workspace_id = $2 and ($3::text is null or network = $3) order by network, created_at", [input.tenantId, input.workspaceId, input.network ?? null]);
    return this.withConnections(result.rows);
  }

  async updateAccount(input: { tenantId: string; id: string; patch: SocialAccountPatch }): Promise<SocialAccount | undefined> {
    const sets: string[] = [];
    const params: unknown[] = [input.id, input.tenantId];
    for (const [key, value] of Object.entries(input.patch) as [keyof SocialAccountPatch, unknown][]) {
      const column = ACCOUNT_COLUMNS[key];
      if (!column) continue;
      params.push(value === undefined ? null : JSON_COLUMNS.has(column) ? JSON.stringify(value) : value);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) {
      const current = await this.pool.query<AccountRow>("select * from social_accounts where id = $1 and tenant_id = $2", params);
      return (await this.withConnections(current.rows))[0];
    }
    const result = await this.pool.query<AccountRow>(`update social_accounts set ${sets.join(", ")}, updated_at = now() where id = $1 and tenant_id = $2 returning *`, params);
    return (await this.withConnections(result.rows))[0];
  }

  async listAccountsDueForHealthCheck(input: { olderThan: string; limit: number }): Promise<SocialAccount[]> {
    const result = await this.pool.query<AccountRow>(
      "select * from social_accounts where status in ('CONNECTED','HEALTHY','TEMPORARY_ERROR') and (last_health_check_at is null or last_health_check_at <= $1) order by last_health_check_at nulls first limit $2",
      [input.olderThan, input.limit],
    );
    return this.withConnections(result.rows);
  }

  async listAccountsByProvider(input: { providerType: SocialProviderType; tenantId?: string }): Promise<SocialAccount[]> {
    const result = await this.pool.query<AccountRow>(
      "select a.* from social_accounts a where exists (select 1 from social_account_connections c where c.social_account_id = a.id and c.provider_type = $1) and ($2::text is null or a.tenant_id = $2)",
      [input.providerType, input.tenantId ?? null],
    );
    return this.withConnections(result.rows);
  }

  async listTenantAccounts(input: { tenantId: string; network?: SocialNetwork }): Promise<SocialAccount[]> {
    const result = await this.pool.query<AccountRow>("select * from social_accounts where tenant_id = $1 and ($2::text is null or network = $2) order by network, created_at", [input.tenantId, input.network ?? null]);
    return this.withConnections(result.rows);
  }

  async upsertConnection(input: { tenantId: string; accountId: string; connection: Omit<SocialAccountConnection, "connectedAt" | "updatedAt"> & { connectedAt?: string } }): Promise<void> {
    // A conta precisa pertencer ao tenant: nenhuma conexão é gravada em conta de outro tenant.
    const result = await this.pool.query(
      `insert into social_account_connections (social_account_id, tenant_id, provider_type, credential_reference_id, status, connected_at, updated_at)
       select a.id, a.tenant_id, $3, $4, $5, coalesce($6::timestamptz, now()), now() from social_accounts a where a.id = $1 and a.tenant_id = $2
       on conflict (social_account_id, provider_type) do update set credential_reference_id = excluded.credential_reference_id, status = excluded.status, updated_at = now()`,
      [input.accountId, input.tenantId, input.connection.providerType, input.connection.credentialReferenceId, input.connection.status, input.connection.connectedAt ?? null],
    );
    if ((result.rowCount ?? 0) === 0) throw new Error("SOCIAL_ACCOUNT_NOT_FOUND: conta social não encontrada.");
  }

  async removeConnection(input: { tenantId: string; accountId: string; providerType: SocialProviderType }): Promise<void> {
    await this.pool.query("delete from social_account_connections where social_account_id = $1 and tenant_id = $2 and provider_type = $3", [input.accountId, input.tenantId, input.providerType]);
  }

  async getPolicy(input: { tenantId: string; network: SocialNetwork }): Promise<SocialProviderPolicy | undefined> {
    const result = await this.pool.query<PolicyRow>("select * from social_provider_policies where tenant_id = $1 and network = $2", [input.tenantId, input.network]);
    return result.rows[0] ? toPolicy(result.rows[0]) : undefined;
  }

  async listPolicies(input: { tenantId?: string }): Promise<SocialProviderPolicy[]> {
    const result = await this.pool.query<PolicyRow>("select * from social_provider_policies where ($1::text is null or tenant_id = $1) order by tenant_id, network", [input.tenantId ?? null]);
    return result.rows.map(toPolicy);
  }

  async upsertPolicy(input: SocialProviderPolicy): Promise<SocialProviderPolicy> {
    const result = await this.pool.query<PolicyRow>(
      `insert into social_provider_policies (tenant_id, network, publishing_enabled, preferred_provider, enabled_providers, late_policy, rate_limits, updated_by, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,now())
       on conflict (tenant_id, network) do update set publishing_enabled = excluded.publishing_enabled, preferred_provider = excluded.preferred_provider, enabled_providers = excluded.enabled_providers,
         late_policy = excluded.late_policy, rate_limits = excluded.rate_limits, updated_by = excluded.updated_by, updated_at = now()
       returning *`,
      [input.tenantId, input.network, input.publishingEnabled, input.preferredProvider, [...input.enabledProviders], JSON.stringify(input.latePolicy), JSON.stringify(input.rateLimits), input.updatedBy ?? null],
    );
    return toPolicy(result.rows[0]!);
  }

  async getSwitch(providerType: SocialProviderType): Promise<SocialProviderSwitch | undefined> {
    const result = await this.pool.query<SwitchRow>("select * from social_provider_switches where provider_type = $1", [providerType]);
    return result.rows[0] ? toSwitch(result.rows[0]) : undefined;
  }

  async listSwitches(): Promise<SocialProviderSwitch[]> {
    const result = await this.pool.query<SwitchRow>("select * from social_provider_switches order by provider_type");
    return result.rows.map(toSwitch);
  }

  async upsertSwitch(input: SocialProviderSwitch): Promise<SocialProviderSwitch> {
    const result = await this.pool.query<SwitchRow>(
      `insert into social_provider_switches (provider_type, enabled, approved, reason, updated_by, updated_at) values ($1,$2,$3,$4,$5,now())
       on conflict (provider_type) do update set enabled = excluded.enabled, approved = excluded.approved, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = now()
       returning *`,
      [input.providerType, input.enabled, input.approved, input.reason ?? null, input.updatedBy ?? null],
    );
    return toSwitch(result.rows[0]!);
  }

  async createDestinations(inputs: readonly Omit<SocialPostDestination, "createdAt" | "updatedAt">[]): Promise<SocialPostDestination[]> {
    const created: SocialPostDestination[] = [];
    for (const input of inputs) {
      const result = await this.pool.query<DestinationRow>(
        `insert into social_post_destinations (id, tenant_id, workspace_id, publication_id, target_id, social_account_id, network, format, caption, hashtags, music, audio_mode, media, scheduled_at, timezone, block_reason, blocked_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,
        [input.id, input.tenantId, input.workspaceId, input.publicationId, input.targetId, input.socialAccountId, input.network, input.format, input.caption, [...input.hashtags], input.music ? JSON.stringify(input.music) : null, input.audioMode, JSON.stringify(input.media), input.scheduledAt ?? null, input.timezone ?? null, input.blockReason ?? null, input.blockedAt ?? null, input.createdBy],
      );
      created.push(toDestination(result.rows[0]!));
    }
    return created;
  }

  async getDestinationByTarget(input: { targetId: string }): Promise<SocialPostDestination | undefined> {
    const result = await this.pool.query<DestinationRow>("select * from social_post_destinations where target_id = $1", [input.targetId]);
    return result.rows[0] ? toDestination(result.rows[0]) : undefined;
  }

  async getDestination(input: { tenantId: string; workspaceId: string; id: string }): Promise<SocialPostDestination | undefined> {
    const result = await this.pool.query<DestinationRow>("select * from social_post_destinations where id = $1 and tenant_id = $2 and workspace_id = $3", [input.id, input.tenantId, input.workspaceId]);
    return result.rows[0] ? toDestination(result.rows[0]) : undefined;
  }

  async listDestinationsByPublication(input: { tenantId: string; workspaceId: string; publicationId: string }): Promise<SocialPostDestination[]> {
    const result = await this.pool.query<DestinationRow>("select * from social_post_destinations where tenant_id = $1 and workspace_id = $2 and publication_id = $3 order by created_at, id", [input.tenantId, input.workspaceId, input.publicationId]);
    return result.rows.map(toDestination);
  }

  async listDestinations(input: { tenantId: string; workspaceId: string; from?: string; to?: string; socialAccountId?: string; limit?: number }): Promise<SocialPostDestination[]> {
    const result = await this.pool.query<DestinationRow>(
      `select * from social_post_destinations
       where tenant_id = $1 and workspace_id = $2
         and ($3::timestamptz is null or coalesce(scheduled_at, created_at) >= $3)
         and ($4::timestamptz is null or coalesce(scheduled_at, created_at) <= $4)
         and ($5::text is null or social_account_id = $5)
       order by coalesce(scheduled_at, created_at), id limit $6`,
      [input.tenantId, input.workspaceId, input.from ?? null, input.to ?? null, input.socialAccountId ?? null, input.limit ?? 500],
    );
    return result.rows.map(toDestination);
  }

  async listBlockedDestinations(input: { tenantId: string; socialAccountId?: string; blockReason?: SocialBlockReason; providerType?: SocialProviderType }): Promise<SocialPostDestination[]> {
    const result = await this.pool.query<DestinationRow>(
      `select d.* from social_post_destinations d join social_accounts a on a.id = d.social_account_id
       where d.tenant_id = $1 and d.block_reason is not null
         and ($2::text is null or d.social_account_id = $2)
         and ($3::text is null or d.block_reason = $3)
         and ($4::text is null or a.provider_type = $4)
       order by coalesce(d.scheduled_at, d.created_at), d.id`,
      [input.tenantId, input.socialAccountId ?? null, input.blockReason ?? null, input.providerType ?? null],
    );
    return result.rows.map(toDestination);
  }

  async updateDestination(input: { tenantId: string; id: string; patch: Partial<Pick<SocialPostDestination, "blockReason" | "blockedAt" | "skippedAt" | "lastProviderType" | "lastErrorCode" | "lastErrorMessage" | "scheduledAt" | "timezone" | "caption" | "music" | "audioMode">> & { clearBlock?: boolean } }): Promise<SocialPostDestination | undefined> {
    const { clearBlock, ...patch } = input.patch;
    const sets: string[] = [];
    const params: unknown[] = [input.id, input.tenantId];
    for (const [key, value] of Object.entries(patch) as [keyof typeof DESTINATION_COLUMNS, unknown][]) {
      const column = DESTINATION_COLUMNS[key];
      if (!column) continue;
      params.push(value === undefined ? null : JSON_COLUMNS.has(column) ? JSON.stringify(value) : value);
      sets.push(`${column} = $${params.length}`);
    }
    if (clearBlock) sets.push("block_reason = null", "blocked_at = null");
    if (sets.length === 0) return undefined;
    const result = await this.pool.query<DestinationRow>(`update social_post_destinations set ${sets.join(", ")}, updated_at = now() where id = $1 and tenant_id = $2 returning *`, params);
    return result.rows[0] ? toDestination(result.rows[0]) : undefined;
  }

  async appendPublishLog(entry: SocialPublishLogEntry): Promise<void> {
    await this.pool.query(
      `insert into social_publish_log (id, tenant_id, workspace_id, social_account_id, publication_id, target_id, provider_type, network, format, started_at, finished_at, outcome, error_code, duration_ms, media_bytes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [entry.id, entry.tenantId, entry.workspaceId, entry.socialAccountId, entry.publicationId, entry.targetId, entry.providerType, entry.network, entry.format, entry.startedAt, entry.finishedAt ?? null, entry.outcome ?? null, entry.errorCode ?? null, entry.durationMs ?? null, entry.mediaBytes ?? null],
    );
  }

  async finishPublishLog(input: { id: string; finishedAt: string; outcome: SocialPublishLogEntry["outcome"]; errorCode?: string; durationMs?: number }): Promise<void> {
    await this.pool.query("update social_publish_log set finished_at = $2, outcome = $3, error_code = $4, duration_ms = $5 where id = $1", [input.id, input.finishedAt, input.outcome ?? null, input.errorCode ?? null, input.durationMs ?? null]);
  }

  async countPublishLog(input: { socialAccountId: string; since: string; outcomes?: readonly NonNullable<SocialPublishLogEntry["outcome"]>[] }): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "select count(*) from social_publish_log where social_account_id = $1 and started_at >= $2 and ($3::text[] is null or outcome is null or outcome = any($3::text[]))",
      [input.socialAccountId, input.since, input.outcomes ? [...input.outcomes] : null],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async lastPublishLog(input: { socialAccountId: string }): Promise<SocialPublishLogEntry | undefined> {
    const result = await this.pool.query<LogRow>("select * from social_publish_log where social_account_id = $1 order by started_at desc limit 1", [input.socialAccountId]);
    return result.rows[0] ? toLog(result.rows[0]) : undefined;
  }

  async listPublishLog(input: { tenantId?: string; since: string; limit?: number }): Promise<SocialPublishLogEntry[]> {
    const result = await this.pool.query<LogRow>("select * from social_publish_log where ($1::text is null or tenant_id = $1) and started_at >= $2 order by started_at desc limit $3", [input.tenantId ?? null, input.since, input.limit ?? 1000]);
    return result.rows.map(toLog);
  }

  async claimNotification(input: { tenantId: string; dedupeKey: string; now: string; windowMs: number }): Promise<boolean> {
    // Atômico: só um processo vence a janela de silêncio.
    const result = await this.pool.query(
      `insert into social_notification_dedupe (tenant_id, dedupe_key, last_sent_at) values ($1,$2,$3)
       on conflict (tenant_id, dedupe_key) do update set last_sent_at = excluded.last_sent_at
       where social_notification_dedupe.last_sent_at <= $3::timestamptz - ($4 || ' milliseconds')::interval`,
      [input.tenantId, input.dedupeKey, input.now, input.windowMs],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function iso(value: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

function toConnection(row: ConnectionRow): SocialAccountConnection {
  return { providerType: row.provider_type as SocialProviderType, credentialReferenceId: row.credential_reference_id, status: row.status as SocialAccountConnection["status"], connectedAt: row.connected_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

function toAccount(row: AccountRow, connections: readonly SocialAccountConnection[]): SocialAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    network: row.network as SocialNetwork,
    providerType: row.provider_type as SocialProviderType,
    externalAccountId: row.external_account_id,
    ...(row.username ? { username: row.username } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    status: row.status as SocialAccount["status"],
    connections,
    accountCapabilities: row.account_capabilities ?? {},
    metadata: row.metadata ?? {},
    consecutiveFailures: row.consecutive_failures,
    connectedAt: iso(row.connected_at),
    lastHealthCheckAt: iso(row.last_health_check_at),
    lastSuccessfulPublishAt: iso(row.last_successful_publish_at),
    reauthRequiredAt: iso(row.reauth_required_at),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    lastErrorAt: iso(row.last_error_at),
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toPolicy(row: PolicyRow): SocialProviderPolicy {
  return {
    tenantId: row.tenant_id,
    network: row.network as SocialNetwork,
    publishingEnabled: row.publishing_enabled,
    preferredProvider: row.preferred_provider as SocialProviderType,
    enabledProviders: (row.enabled_providers ?? []) as SocialProviderType[],
    latePolicy: { ...DEFAULT_LATE_POLICY, ...(row.late_policy ?? {}) },
    rateLimits: { ...DEFAULT_RATE_LIMITS, ...(row.rate_limits ?? {}) },
    ...(row.updated_by ? { updatedBy: row.updated_by } : {}),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSwitch(row: SwitchRow): SocialProviderSwitch {
  return { providerType: row.provider_type as SocialProviderType, enabled: row.enabled, approved: row.approved, ...(row.reason ? { reason: row.reason } : {}), ...(row.updated_by ? { updatedBy: row.updated_by } : {}), updatedAt: row.updated_at.toISOString() };
}

function toDestination(row: DestinationRow): SocialPostDestination {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    publicationId: row.publication_id,
    targetId: row.target_id,
    socialAccountId: row.social_account_id,
    network: row.network as SocialNetwork,
    format: row.format as SocialPostDestination["format"],
    caption: row.caption,
    hashtags: row.hashtags ?? [],
    ...(row.music ? { music: row.music } : {}),
    audioMode: row.audio_mode as SocialPostDestination["audioMode"],
    media: row.media ?? [],
    scheduledAt: iso(row.scheduled_at),
    ...(row.timezone ? { timezone: row.timezone } : {}),
    ...(row.block_reason ? { blockReason: row.block_reason as SocialBlockReason } : {}),
    blockedAt: iso(row.blocked_at),
    skippedAt: iso(row.skipped_at),
    ...(row.last_provider_type ? { lastProviderType: row.last_provider_type as SocialProviderType } : {}),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.last_error_message ? { lastErrorMessage: row.last_error_message } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toLog(row: LogRow): SocialPublishLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    socialAccountId: row.social_account_id,
    publicationId: row.publication_id,
    targetId: row.target_id,
    providerType: row.provider_type as SocialProviderType,
    network: row.network as SocialNetwork,
    format: row.format,
    startedAt: row.started_at.toISOString(),
    finishedAt: iso(row.finished_at),
    ...(row.outcome ? { outcome: row.outcome as SocialPublishLogEntry["outcome"] } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.media_bytes !== null ? { mediaBytes: Number(row.media_bytes) } : {}),
  };
}
