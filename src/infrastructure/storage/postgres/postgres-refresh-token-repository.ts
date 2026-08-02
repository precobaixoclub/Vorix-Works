import type { Pool } from "pg";
import type {
  CreateRefreshTokenInput,
  RefreshTokenRepositoryPort,
} from "../../../application/ports/refresh-token-repository.port.js";
import type { RefreshToken } from "../../../domain/identity/identity.model.js";

export type RefreshTokenIdGenerator = () => string;
const defaultIdGenerator: RefreshTokenIdGenerator = () => `refresh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type RefreshTokenRow = {
  id: string;
  session_id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_token_id: string | null;
};

export class PostgresRefreshTokenRepository implements RefreshTokenRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: RefreshTokenIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: RefreshTokenIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async create(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    const id = this.idGenerator();
    const result = await this.pool.query<RefreshTokenRow>(
      `insert into refresh_tokens (id, session_id, user_id, token_hash, created_at, expires_at)
       values ($1, $2, $3, $4, now(), $5)
       returning *`,
      [id, input.sessionId, input.userId, input.tokenHash, input.expiresAt],
    );
    return this.toDomain(result.rows[0]);
  }

  async getByHash(tokenHash: string): Promise<RefreshToken | undefined> {
    const result = await this.pool.query<RefreshTokenRow>("select * from refresh_tokens where token_hash = $1", [tokenHash]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async markRotated(id: string, replacedByTokenId: string): Promise<void> {
    await this.pool.query("update refresh_tokens set revoked_at = now(), replaced_by_token_id = $2 where id = $1", [
      id,
      replacedByTokenId,
    ]);
  }

  async revoke(id: string): Promise<void> {
    await this.pool.query("update refresh_tokens set revoked_at = now() where id = $1 and revoked_at is null", [id]);
  }

  async revokeAllForSession(sessionId: string): Promise<void> {
    await this.pool.query("update refresh_tokens set revoked_at = now() where session_id = $1 and revoked_at is null", [sessionId]);
  }

  private toDomain(row: RefreshTokenRow): RefreshToken {
    return {
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      revokedAt: row.revoked_at ? row.revoked_at.toISOString() : undefined,
      replacedByTokenId: row.replaced_by_token_id ?? undefined,
    };
  }
}
