import type { Pool } from "pg";
import type { CreateTenantMemberInviteInput, TenantMemberInviteRepositoryPort } from "../../../application/ports/tenant-member-invite-repository.port.js";
import type { TenantMemberInvite, TenantMemberInviteStatus } from "../../../domain/identity/identity.model.js";

const idGenerator = () => `invite-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type InviteRow = {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  token_hash: string;
  status: string;
  invited_by_user_id: string;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
};

export class PostgresTenantMemberInviteRepository implements TenantMemberInviteRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateTenantMemberInviteInput): Promise<TenantMemberInvite> {
    const result = await this.pool.query<InviteRow>(
      `insert into tenant_member_invites (id, tenant_id, email, role, token_hash, invited_by_user_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [idGenerator(), input.tenantId, input.email, input.role, input.tokenHash, input.invitedByUserId, input.expiresAt],
    );
    return this.toDomain(result.rows[0]);
  }

  async getByTokenHash(tokenHash: string): Promise<TenantMemberInvite | undefined> {
    const result = await this.pool.query<InviteRow>("select * from tenant_member_invites where token_hash = $1", [tokenHash]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByTenant(tenantId: string): Promise<TenantMemberInvite[]> {
    const result = await this.pool.query<InviteRow>(
      "select * from tenant_member_invites where tenant_id = $1 order by created_at desc",
      [tenantId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async updateStatus(id: string, input: { expectedStatus: TenantMemberInviteStatus; status: TenantMemberInviteStatus; acceptedAt?: string }): Promise<TenantMemberInvite | undefined> {
    const result = await this.pool.query<InviteRow>(
      `update tenant_member_invites set status = $3, accepted_at = coalesce($4, accepted_at)
       where id = $1 and status = $2
       returning *`,
      [id, input.expectedStatus, input.status, input.acceptedAt ?? null],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  private toDomain(row: InviteRow): TenantMemberInvite {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      role: row.role as TenantMemberInvite["role"],
      tokenHash: row.token_hash,
      status: row.status as TenantMemberInvite["status"],
      invitedByUserId: row.invited_by_user_id,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      acceptedAt: row.accepted_at?.toISOString(),
    };
  }
}
