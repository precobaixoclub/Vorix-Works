import type { Pool } from "pg";
import type {
  CreateMembershipInput,
  TenantMembershipRepositoryPort,
} from "../../../application/ports/tenant-membership-repository.port.js";
import type { TenantMemberStatus, TenantMembership } from "../../../domain/identity/identity.model.js";

export type MembershipIdGenerator = () => string;
const defaultIdGenerator: MembershipIdGenerator = () => `membership-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const UNIQUE_VIOLATION = "23505";

type MembershipRow = {
  id: string;
  user_id: string;
  tenant_id: string;
  role: string;
  permission_grants: string[] | null;
  permission_revokes: string[] | null;
  status: string | null;
  is_account_owner: boolean | null;
  created_at: Date;
  updated_at: Date;
};

export class PostgresTenantMembershipRepository implements TenantMembershipRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: MembershipIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: MembershipIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async create(input: CreateMembershipInput): Promise<TenantMembership> {
    const id = this.idGenerator();
    try {
      const result = await this.pool.query<MembershipRow>(
        `insert into tenant_members (id, user_id, tenant_id, role, is_account_owner, created_at, updated_at)
         values ($1, $2, $3, $4, $5, now(), now())
         returning *`,
        [id, input.userId, input.tenantId, input.role, input.isAccountOwner ?? false],
      );
      return this.toDomain(result.rows[0]);
    } catch (error) {
      if (isPgError(error) && error.code === UNIQUE_VIOLATION) {
        throw new Error(`MEMBERSHIP_ALREADY_EXISTS: usuário "${input.userId}" já pertence ao tenant "${input.tenantId}".`);
      }
      throw error;
    }
  }

  async getByUserAndTenant(userId: string, tenantId: string): Promise<TenantMembership | undefined> {
    const result = await this.pool.query<MembershipRow>("select * from tenant_members where user_id = $1 and tenant_id = $2", [
      userId,
      tenantId,
    ]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByUser(userId: string): Promise<TenantMembership[]> {
    const result = await this.pool.query<MembershipRow>("select * from tenant_members where user_id = $1 order by created_at asc", [
      userId,
    ]);
    return result.rows.map((row) => this.toDomain(row));
  }

  async listByTenant(tenantId: string): Promise<TenantMembership[]> {
    const result = await this.pool.query<MembershipRow>(
      "select * from tenant_members where tenant_id = $1 order by created_at asc",
      [tenantId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async updateRole(userId: string, tenantId: string, role: TenantMembership["role"]): Promise<TenantMembership | undefined> {
    const result = await this.pool.query<MembershipRow>(
      "update tenant_members set role = $3, updated_at = now() where user_id = $1 and tenant_id = $2 returning *",
      [userId, tenantId, role],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async updateAccess(userId: string, tenantId: string, input: { role: TenantMembership["role"]; permissionGrants: readonly string[]; permissionRevokes: readonly string[] }): Promise<TenantMembership | undefined> {
    const result = await this.pool.query<MembershipRow>(
      "update tenant_members set role = $3, permission_grants = $4, permission_revokes = $5, updated_at = now() where user_id = $1 and tenant_id = $2 returning *",
      [userId, tenantId, input.role, [...input.permissionGrants], [...input.permissionRevokes]],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async setStatus(userId: string, tenantId: string, status: TenantMemberStatus): Promise<TenantMembership | undefined> {
    const result = await this.pool.query<MembershipRow>(
      "update tenant_members set status = $3, disabled_at = case when $3 = 'disabled' then now() else null end, updated_at = now() where user_id = $1 and tenant_id = $2 returning *",
      [userId, tenantId, status],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async remove(userId: string, tenantId: string): Promise<void> {
    await this.pool.query("delete from tenant_members where user_id = $1 and tenant_id = $2", [userId, tenantId]);
  }

  private toDomain(row: MembershipRow): TenantMembership {
    return {
      id: row.id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      role: row.role as TenantMembership["role"],
      permissionGrants: row.permission_grants ?? [],
      permissionRevokes: row.permission_revokes ?? [],
      status: row.status === "disabled" ? "disabled" : "active",
      isAccountOwner: row.is_account_owner === true,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

function isPgError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}
