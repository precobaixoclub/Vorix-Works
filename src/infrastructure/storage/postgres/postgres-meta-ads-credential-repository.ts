import type { Pool } from "pg";
import type {
  CreateMetaAdsCredentialReferenceInput,
  MetaAdsCredentialProvider,
  MetaAdsCredentialReference,
  MetaAdsCredentialRepositoryPort,
  MetaAdsCredentialStatus,
} from "../../../application/ports/meta-ads-credential-repository.port.js";

/** Escreve na MESMA tabela física `publication_credential_references` (ver comentário do port) —
 * nunca uma tabela nova, é literalmente o mesmo armazém genérico de referência de credencial. */
type CredentialReferenceRow = {
  credential_reference_id: string;
  tenant_id: string;
  workspace_id: string;
  provider_id: string;
  status: string;
  environment: string | null;
  provider_subject_id: string | null;
  scopes: string[] | null;
  expires_at: Date | null;
  last_refreshed_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: CredentialReferenceRow): MetaAdsCredentialReference {
  return {
    credentialReferenceId: row.credential_reference_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    providerId: row.provider_id as MetaAdsCredentialProvider,
    status: row.status as MetaAdsCredentialStatus,
    environment: (row.environment as "sandbox" | "production" | null) ?? undefined,
    providerSubjectId: row.provider_subject_id ?? undefined,
    scopes: row.scopes ?? undefined,
    expiresAt: row.expires_at?.toISOString(),
    lastRefreshedAt: row.last_refreshed_at?.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresMetaAdsCredentialRepository implements MetaAdsCredentialRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertCredentialReference(input: CreateMetaAdsCredentialReferenceInput): Promise<MetaAdsCredentialReference> {
    const result = await this.pool.query<CredentialReferenceRow>(
      `insert into publication_credential_references
         (credential_reference_id, tenant_id, workspace_id, provider_id, status, environment, provider_subject_id, scopes, expires_at, last_refreshed_at, revoked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (credential_reference_id) do update
       set status = excluded.status,
           environment = excluded.environment,
           provider_subject_id = excluded.provider_subject_id,
           scopes = excluded.scopes,
           expires_at = excluded.expires_at,
           last_refreshed_at = excluded.last_refreshed_at,
           revoked_at = excluded.revoked_at,
           updated_at = now()
       returning *`,
      [
        input.credentialReferenceId,
        input.tenantId,
        input.workspaceId,
        input.providerId,
        input.status,
        input.environment ?? null,
        input.providerSubjectId ?? null,
        input.scopes ? [...input.scopes] : null,
        input.expiresAt ?? null,
        input.lastRefreshedAt ?? null,
        input.revokedAt ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async getCredentialReference(credentialReferenceId: string): Promise<MetaAdsCredentialReference | undefined> {
    const result = await this.pool.query<CredentialReferenceRow>("select * from publication_credential_references where credential_reference_id = $1", [credentialReferenceId]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listCredentialReferencesByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MetaAdsCredentialReference[]> {
    const result = await this.pool.query<CredentialReferenceRow>(
      "select * from publication_credential_references where tenant_id = $1 and workspace_id = $2 and provider_id = $3 order by created_at desc",
      [input.tenantId, input.workspaceId, "meta_ads" satisfies MetaAdsCredentialProvider],
    );
    return result.rows.map(toDomain);
  }

  async updateStatus(credentialReferenceId: string, status: MetaAdsCredentialStatus): Promise<void> {
    await this.pool.query(
      `update publication_credential_references set status = $2, revoked_at = case when $2 = 'revoked' then now() else revoked_at end, updated_at = now() where credential_reference_id = $1`,
      [credentialReferenceId, status],
    );
  }

  async touchLastRefreshed(credentialReferenceId: string, expiresAt?: string): Promise<void> {
    await this.pool.query(
      "update publication_credential_references set last_refreshed_at = now(), expires_at = coalesce($2, expires_at), updated_at = now() where credential_reference_id = $1",
      [credentialReferenceId, expiresAt ?? null],
    );
  }
}
