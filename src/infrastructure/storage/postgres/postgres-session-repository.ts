import type { Pool } from "pg";
import type { CreateSessionInput, SessionRepositoryPort } from "../../../application/ports/session-repository.port.js";
import type { UserSession } from "../../../domain/identity/identity.model.js";

export type SessionIdGenerator = () => string;
const defaultIdGenerator: SessionIdGenerator = () => `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type SessionRow = {
  id: string;
  user_id: string;
  active_tenant_id: string;
  created_at: Date;
  last_used_at: Date;
  revoked_at: Date | null;
  user_agent: string | null;
  ip_address: string | null;
};

export class PostgresSessionRepository implements SessionRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: SessionIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: SessionIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async create(input: CreateSessionInput): Promise<UserSession> {
    const id = this.idGenerator();
    const result = await this.pool.query<SessionRow>(
      `insert into user_sessions (id, user_id, active_tenant_id, created_at, last_used_at, user_agent, ip_address)
       values ($1, $2, $3, now(), now(), $4, $5)
       returning *`,
      [id, input.userId, input.activeTenantId, input.userAgent ?? null, input.ipAddress ?? null],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<UserSession | undefined> {
    const result = await this.pool.query<SessionRow>("select * from user_sessions where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async touch(id: string): Promise<void> {
    await this.pool.query("update user_sessions set last_used_at = now() where id = $1", [id]);
  }

  async revoke(id: string): Promise<void> {
    await this.pool.query("update user_sessions set revoked_at = now() where id = $1 and revoked_at is null", [id]);
  }

  async updateActiveTenant(id: string, tenantId: string): Promise<void> {
    await this.pool.query("update user_sessions set active_tenant_id = $2, last_used_at = now() where id = $1", [id, tenantId]);
  }

  private toDomain(row: SessionRow): UserSession {
    return {
      id: row.id,
      userId: row.user_id,
      activeTenantId: row.active_tenant_id,
      createdAt: row.created_at.toISOString(),
      lastUsedAt: row.last_used_at.toISOString(),
      revokedAt: row.revoked_at ? row.revoked_at.toISOString() : undefined,
      userAgent: row.user_agent ?? undefined,
      ipAddress: row.ip_address ?? undefined,
    };
  }
}
