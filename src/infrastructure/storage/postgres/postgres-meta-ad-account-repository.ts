import type { Pool } from "pg";
import type { MetaAdAccount, MetaAdAccountRepositoryPort, UpsertMetaAdAccountInput } from "../../../application/ports/meta-ad-account-repository.port.js";

type MetaAdAccountRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  credential_reference_id: string;
  account_id: string;
  name: string;
  currency: string;
  account_status: number | null;
  business_name: string | null;
  timezone_name: string | null;
  spend_cap: string | null;
  balance: string | null;
  disable_reason: string | null;
  is_active: boolean;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: MetaAdAccountRow): MetaAdAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    credentialReferenceId: row.credential_reference_id,
    accountId: row.account_id,
    name: row.name,
    currency: row.currency,
    accountStatus: row.account_status ?? undefined,
    businessName: row.business_name ?? undefined,
    timezoneName: row.timezone_name ?? undefined,
    spendCap: row.spend_cap === null ? undefined : Number(row.spend_cap),
    balance: row.balance === null ? undefined : Number(row.balance),
    disableReason: row.disable_reason ?? undefined,
    isActive: row.is_active,
    lastSyncedAt: row.last_synced_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function buildId(workspaceId: string, credentialReferenceId: string, accountId: string): string {
  return `maa-${workspaceId}-${credentialReferenceId}-${accountId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class PostgresMetaAdAccountRepository implements MetaAdAccountRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertAccount(input: UpsertMetaAdAccountInput): Promise<MetaAdAccount> {
    const id = input.id ?? buildId(input.workspaceId, input.credentialReferenceId, input.accountId);
    const result = await this.pool.query<MetaAdAccountRow>(
      `insert into meta_ad_accounts
         (id, tenant_id, workspace_id, credential_reference_id, account_id, name, currency, account_status, business_name, timezone_name, spend_cap, balance, disable_reason, is_active, last_synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       on conflict (workspace_id, credential_reference_id, account_id) do update
       set name = excluded.name,
           currency = excluded.currency,
           account_status = excluded.account_status,
           business_name = excluded.business_name,
           timezone_name = excluded.timezone_name,
           spend_cap = excluded.spend_cap,
           balance = excluded.balance,
           disable_reason = excluded.disable_reason,
           is_active = excluded.is_active,
           last_synced_at = now(),
           updated_at = now()
       returning *`,
      [
        id,
        input.tenantId,
        input.workspaceId,
        input.credentialReferenceId,
        input.accountId,
        input.name,
        input.currency,
        input.accountStatus ?? null,
        input.businessName ?? null,
        input.timezoneName ?? null,
        input.spendCap ?? null,
        input.balance ?? null,
        input.disableReason ?? null,
        input.isActive,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MetaAdAccount[]> {
    const result = await this.pool.query<MetaAdAccountRow>(
      "select * from meta_ad_accounts where tenant_id = $1 and workspace_id = $2 order by created_at desc",
      [input.tenantId, input.workspaceId],
    );
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<MetaAdAccount | undefined> {
    const result = await this.pool.query<MetaAdAccountRow>("select * from meta_ad_accounts where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listAllActive(): Promise<MetaAdAccount[]> {
    const result = await this.pool.query<MetaAdAccountRow>("select * from meta_ad_accounts where is_active = true order by workspace_id");
    return result.rows.map(toDomain);
  }

  async deactivateMissing(input: { credentialReferenceId: string; keepAccountIds: readonly string[] }): Promise<void> {
    await this.pool.query(
      "update meta_ad_accounts set is_active = false, updated_at = now() where credential_reference_id = $1 and not (account_id = any($2::text[]))",
      [input.credentialReferenceId, [...input.keepAccountIds]],
    );
  }
}
