import type { Pool } from "pg";
import type { CredentialRepositoryPort } from "../../../application/ports/credential-repository.port.js";
import type { Credential, CredentialBinding, CredentialDetail, CredentialHealth, CredentialReference, CredentialRotation, CredentialStatus } from "../../../domain/credential/credential.model.js";
import type { PublicationProvider } from "../../../domain/publication/publication.model.js";

type CredentialRow = { id: string; tenant_id: string; workspace_id: string; provider_id: string; environment: string; status: string; active_reference_id: string | null; provider_subject_id: string | null; required_scopes: string[]; granted_scopes: string[]; missing_scopes: string[]; expires_at: Date | null; last_health_check_at: Date | null; created_at: Date; updated_at: Date };
type ReferenceRow = { id: string; credential_id: string; tenant_id: string; workspace_id: string; provider_id: string; environment: string; status: string; provider_subject_id: string | null; granted_scopes: string[]; required_scopes: string[]; missing_scopes: string[]; expires_at: Date | null; last_refreshed_at: Date | null; revoked_at: Date | null; created_at: Date; updated_at: Date };
type BindingRow = { id: string; credential_id: string; tenant_id: string; workspace_id: string; provider_id: string; environment: string; canary: boolean; status: string; created_at: Date; updated_at: Date };
type RotationRow = { id: string; credential_id: string; tenant_id: string; workspace_id: string; provider_id: string; old_credential_reference_id: string | null; new_credential_reference_id: string | null; mode: string; status: string; reason: string; actor_user_id: string; scheduled_for: Date | null; started_at: Date | null; completed_at: Date | null; failure_code: string | null; created_at: Date; updated_at: Date };
type HealthRow = { credential_id: string; credential_reference_id: string | null; tenant_id: string; workspace_id: string; provider_id: string; status: string; connected: boolean; token_valid: boolean; expires_at: Date | null; expiring: boolean; expired: boolean; granted_scopes: string[]; required_scopes: string[]; missing_scopes: string[]; provider_subject_id: string | null; last_synced_at: Date | null; checked_at: Date; safe_message: string | null };

export class PostgresCredentialRepository implements CredentialRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertCredential(input: Omit<Credential, "createdAt" | "updatedAt">): Promise<Credential> {
    const result = await this.pool.query<CredentialRow>(
      `insert into credentials (id, tenant_id, workspace_id, provider_id, environment, status, active_reference_id, provider_subject_id, required_scopes, granted_scopes, missing_scopes, expires_at, last_health_check_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (id) do update set status = excluded.status, active_reference_id = excluded.active_reference_id, provider_subject_id = excluded.provider_subject_id, required_scopes = excluded.required_scopes, granted_scopes = excluded.granted_scopes, missing_scopes = excluded.missing_scopes, expires_at = excluded.expires_at, last_health_check_at = excluded.last_health_check_at, updated_at = now()
       returning *`,
      [input.id, input.tenantId, input.workspaceId, input.providerId, input.environment, input.status, input.activeReferenceId ?? null, input.providerSubjectId ?? null, [...input.requiredScopes], [...input.grantedScopes], [...input.missingScopes], input.expiresAt ?? null, input.lastHealthCheckAt ?? null],
    );
    return toCredential(result.rows[0]);
  }

  async getCredential(input: { tenantId: string; workspaceId: string; credentialId: string }): Promise<CredentialDetail | undefined> {
    const result = await this.pool.query<CredentialRow>("select * from credentials where tenant_id = $1 and workspace_id = $2 and id = $3", [input.tenantId, input.workspaceId, input.credentialId]);
    return result.rows[0] ? this.detail(toCredential(result.rows[0])) : undefined;
  }

  async getCredentialByReference(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<CredentialDetail | undefined> {
    const result = await this.pool.query<ReferenceRow>("select * from credential_references where tenant_id = $1 and workspace_id = $2 and id = $3", [input.tenantId, input.workspaceId, input.credentialReferenceId]);
    return result.rows[0] ? this.getCredential({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId: result.rows[0].credential_id }) : undefined;
  }

  async listCredentials(filter: { tenantId: string; workspaceId: string; providerId?: PublicationProvider; status?: CredentialStatus }): Promise<Credential[]> {
    const result = await this.pool.query<CredentialRow>("select * from credentials where tenant_id = $1 and workspace_id = $2 and ($3::text is null or provider_id = $3) and ($4::text is null or status = $4) order by created_at desc", [filter.tenantId, filter.workspaceId, filter.providerId ?? null, filter.status ?? null]);
    return result.rows.map(toCredential);
  }

  async updateCredentialStatus(input: { tenantId: string; workspaceId: string; credentialId: string; status: CredentialStatus; activeReferenceId?: string; expiresAt?: string; lastHealthCheckAt?: string }): Promise<Credential> {
    const result = await this.pool.query<CredentialRow>("update credentials set status = $4, active_reference_id = coalesce($5, active_reference_id), expires_at = coalesce($6, expires_at), last_health_check_at = coalesce($7, last_health_check_at), updated_at = now() where tenant_id = $1 and workspace_id = $2 and id = $3 returning *", [input.tenantId, input.workspaceId, input.credentialId, input.status, input.activeReferenceId ?? null, input.expiresAt ?? null, input.lastHealthCheckAt ?? null]);
    if (!result.rows[0]) throw new Error("CREDENTIAL_NOT_FOUND: credencial não encontrada.");
    return toCredential(result.rows[0]);
  }

  async upsertReference(input: Omit<CredentialReference, "createdAt" | "updatedAt">): Promise<CredentialReference> {
    const result = await this.pool.query<ReferenceRow>(
      `insert into credential_references (id, credential_id, tenant_id, workspace_id, provider_id, environment, status, provider_subject_id, granted_scopes, required_scopes, missing_scopes, expires_at, last_refreshed_at, revoked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (id) do update set status = excluded.status, provider_subject_id = excluded.provider_subject_id, granted_scopes = excluded.granted_scopes, required_scopes = excluded.required_scopes, missing_scopes = excluded.missing_scopes, expires_at = excluded.expires_at, last_refreshed_at = excluded.last_refreshed_at, revoked_at = excluded.revoked_at, updated_at = now()
       returning *`,
      [input.id, input.credentialId, input.tenantId, input.workspaceId, input.providerId, input.environment, input.status, input.providerSubjectId ?? null, [...input.grantedScopes], [...input.requiredScopes], [...input.missingScopes], input.expiresAt ?? null, input.lastRefreshedAt ?? null, input.revokedAt ?? null],
    );
    return toReference(result.rows[0]);
  }

  async listReferences(filter: { tenantId: string; workspaceId: string; credentialId?: string; providerId?: PublicationProvider }): Promise<CredentialReference[]> {
    const result = await this.pool.query<ReferenceRow>("select * from credential_references where tenant_id = $1 and workspace_id = $2 and ($3::text is null or credential_id = $3) and ($4::text is null or provider_id = $4) order by created_at desc", [filter.tenantId, filter.workspaceId, filter.credentialId ?? null, filter.providerId ?? null]);
    return result.rows.map(toReference);
  }

  async updateReferenceStatus(input: { tenantId: string; workspaceId: string; credentialReferenceId: string; status: CredentialStatus; revokedAt?: string }): Promise<CredentialReference | undefined> {
    const result = await this.pool.query<ReferenceRow>("update credential_references set status = $4, revoked_at = coalesce($5, revoked_at), updated_at = now() where tenant_id = $1 and workspace_id = $2 and id = $3 returning *", [input.tenantId, input.workspaceId, input.credentialReferenceId, input.status, input.revokedAt ?? null]);
    return result.rows[0] ? toReference(result.rows[0]) : undefined;
  }

  async upsertBinding(input: Omit<CredentialBinding, "createdAt" | "updatedAt">): Promise<CredentialBinding> {
    const result = await this.pool.query<BindingRow>(
      `insert into credential_bindings (id, credential_id, tenant_id, workspace_id, provider_id, environment, canary, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set canary = excluded.canary, status = excluded.status, updated_at = now()
       returning *`,
      [input.id, input.credentialId, input.tenantId, input.workspaceId, input.providerId, input.environment, input.canary, input.status],
    );
    return toBinding(result.rows[0]);
  }

  async listBindings(filter: { tenantId: string; workspaceId: string; credentialId?: string; providerId?: PublicationProvider }): Promise<CredentialBinding[]> {
    const result = await this.pool.query<BindingRow>("select * from credential_bindings where tenant_id = $1 and workspace_id = $2 and ($3::text is null or credential_id = $3) and ($4::text is null or provider_id = $4) order by created_at desc", [filter.tenantId, filter.workspaceId, filter.credentialId ?? null, filter.providerId ?? null]);
    return result.rows.map(toBinding);
  }

  async createRotation(input: Omit<CredentialRotation, "createdAt" | "updatedAt">): Promise<CredentialRotation> {
    const result = await this.pool.query<RotationRow>("insert into credential_rotations (id, credential_id, tenant_id, workspace_id, provider_id, old_credential_reference_id, new_credential_reference_id, mode, status, reason, actor_user_id, scheduled_for, started_at, completed_at, failure_code) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *", [input.id, input.credentialId, input.tenantId, input.workspaceId, input.providerId, input.oldCredentialReferenceId ?? null, input.newCredentialReferenceId ?? null, input.mode, input.status, input.reason, input.actorUserId, input.scheduledFor ?? null, input.startedAt ?? null, input.completedAt ?? null, input.failureCode ?? null]);
    return toRotation(result.rows[0]);
  }

  async updateRotation(input: { tenantId: string; workspaceId: string; rotationId: string; status: CredentialRotation["status"]; newCredentialReferenceId?: string; startedAt?: string; completedAt?: string; failureCode?: string }): Promise<CredentialRotation | undefined> {
    const result = await this.pool.query<RotationRow>("update credential_rotations set status = $4, new_credential_reference_id = coalesce($5, new_credential_reference_id), started_at = coalesce($6, started_at), completed_at = coalesce($7, completed_at), failure_code = coalesce($8, failure_code), updated_at = now() where tenant_id = $1 and workspace_id = $2 and id = $3 returning *", [input.tenantId, input.workspaceId, input.rotationId, input.status, input.newCredentialReferenceId ?? null, input.startedAt ?? null, input.completedAt ?? null, input.failureCode ?? null]);
    return result.rows[0] ? toRotation(result.rows[0]) : undefined;
  }

  async listRotations(filter: { tenantId: string; workspaceId: string; credentialId?: string }): Promise<CredentialRotation[]> {
    const result = await this.pool.query<RotationRow>("select * from credential_rotations where tenant_id = $1 and workspace_id = $2 and ($3::text is null or credential_id = $3) order by created_at desc", [filter.tenantId, filter.workspaceId, filter.credentialId ?? null]);
    return result.rows.map(toRotation);
  }

  async recordHealth(input: CredentialHealth): Promise<CredentialHealth> {
    const result = await this.pool.query<HealthRow>(
      `insert into credential_health (credential_id, credential_reference_id, tenant_id, workspace_id, provider_id, status, connected, token_valid, expires_at, expiring, expired, granted_scopes, required_scopes, missing_scopes, provider_subject_id, last_synced_at, checked_at, safe_message)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       on conflict (credential_id) do update set credential_reference_id = excluded.credential_reference_id, status = excluded.status, connected = excluded.connected, token_valid = excluded.token_valid, expires_at = excluded.expires_at, expiring = excluded.expiring, expired = excluded.expired, granted_scopes = excluded.granted_scopes, required_scopes = excluded.required_scopes, missing_scopes = excluded.missing_scopes, provider_subject_id = excluded.provider_subject_id, last_synced_at = excluded.last_synced_at, checked_at = excluded.checked_at, safe_message = excluded.safe_message
       returning *`,
      [input.credentialId, input.credentialReferenceId ?? null, input.tenantId, input.workspaceId, input.providerId, input.status, input.connected, input.tokenValid, input.expiresAt ?? null, input.expiring, input.expired, [...input.grantedScopes], [...input.requiredScopes], [...input.missingScopes], input.providerSubjectId ?? null, input.lastSyncedAt ?? null, input.checkedAt, input.safeMessage ?? null],
    );
    return toHealth(result.rows[0]);
  }

  async getHealth(input: { tenantId: string; workspaceId: string; credentialId: string }): Promise<CredentialHealth | undefined> {
    const result = await this.pool.query<HealthRow>("select * from credential_health where tenant_id = $1 and workspace_id = $2 and credential_id = $3", [input.tenantId, input.workspaceId, input.credentialId]);
    return result.rows[0] ? toHealth(result.rows[0]) : undefined;
  }

  private async detail(credential: Credential): Promise<CredentialDetail> {
    return {
      credential,
      references: await this.listReferences({ tenantId: credential.tenantId, workspaceId: credential.workspaceId, credentialId: credential.id }),
      bindings: await this.listBindings({ tenantId: credential.tenantId, workspaceId: credential.workspaceId, credentialId: credential.id }),
      rotations: await this.listRotations({ tenantId: credential.tenantId, workspaceId: credential.workspaceId, credentialId: credential.id }),
      health: await this.getHealth({ tenantId: credential.tenantId, workspaceId: credential.workspaceId, credentialId: credential.id }),
    };
  }
}

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toCredential(row: CredentialRow): Credential {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, environment: row.environment as never, status: row.status as never, activeReferenceId: row.active_reference_id ?? undefined, providerSubjectId: row.provider_subject_id ?? undefined, requiredScopes: row.required_scopes ?? [], grantedScopes: row.granted_scopes ?? [], missingScopes: row.missing_scopes ?? [], expiresAt: iso(row.expires_at), lastHealthCheckAt: iso(row.last_health_check_at), createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}

function toReference(row: ReferenceRow): CredentialReference {
  return { id: row.id, credentialId: row.credential_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, environment: row.environment as never, status: row.status as never, providerSubjectId: row.provider_subject_id ?? undefined, grantedScopes: row.granted_scopes ?? [], requiredScopes: row.required_scopes ?? [], missingScopes: row.missing_scopes ?? [], expiresAt: iso(row.expires_at), lastRefreshedAt: iso(row.last_refreshed_at), revokedAt: iso(row.revoked_at), createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}

function toBinding(row: BindingRow): CredentialBinding {
  return { id: row.id, credentialId: row.credential_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, environment: row.environment as never, canary: row.canary, status: row.status as never, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}

function toRotation(row: RotationRow): CredentialRotation {
  return { id: row.id, credentialId: row.credential_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, oldCredentialReferenceId: row.old_credential_reference_id ?? undefined, newCredentialReferenceId: row.new_credential_reference_id ?? undefined, mode: row.mode as never, status: row.status as never, reason: row.reason, actorUserId: row.actor_user_id, scheduledFor: iso(row.scheduled_for), startedAt: iso(row.started_at), completedAt: iso(row.completed_at), failureCode: row.failure_code ?? undefined, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}

function toHealth(row: HealthRow): CredentialHealth {
  return { credentialId: row.credential_id, credentialReferenceId: row.credential_reference_id ?? undefined, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, status: row.status as never, connected: row.connected, tokenValid: row.token_valid, expiresAt: iso(row.expires_at), expiring: row.expiring, expired: row.expired, grantedScopes: row.granted_scopes ?? [], requiredScopes: row.required_scopes ?? [], missingScopes: row.missing_scopes ?? [], providerSubjectId: row.provider_subject_id ?? undefined, lastSyncedAt: iso(row.last_synced_at), checkedAt: requiredIso(row.checked_at), safeMessage: row.safe_message ?? undefined };
}
