import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { OAuthStateConsumeResult, OAuthStateRecord, OAuthStateStorePort } from "../../application/ports/oauth-state-store.port.js";

/** O state é um segredo de portador: guardamos só o hash dele. */
export function hashOAuthState(state: string): string {
  return createHash("sha256").update(`vorix:oauth-state:${state}`).digest("hex");
}

function checkBinding(record: OAuthStateRecord, input: { provider: string; tenantId?: string; userId?: string }): OAuthStateConsumeResult {
  if (record.provider !== input.provider) return { ok: false, reason: "PROVIDER_MISMATCH" };
  if (input.tenantId && record.tenantId !== input.tenantId) return { ok: false, reason: "TENANT_MISMATCH" };
  if (input.userId && record.userId && record.userId !== input.userId) return { ok: false, reason: "USER_MISMATCH" };
  return { ok: true, record };
}

/** Testes e ambientes sem banco (um único processo). */
export class InMemoryOAuthStateStore implements OAuthStateStorePort {
  private readonly states = new Map<string, OAuthStateRecord & { consumedAt?: string }>();

  async create(state: string, record: OAuthStateRecord): Promise<void> {
    this.states.set(hashOAuthState(state), { ...record });
  }

  async consume(input: { state: string; provider: string; now: string; tenantId?: string; userId?: string }): Promise<OAuthStateConsumeResult> {
    const key = hashOAuthState(input.state);
    const record = this.states.get(key);
    if (!record) return { ok: false, reason: "NOT_FOUND" };
    if (record.consumedAt) return { ok: false, reason: "ALREADY_CONSUMED" };
    this.states.set(key, { ...record, consumedAt: input.now, codeVerifier: undefined });
    if (record.expiresAt <= input.now) return { ok: false, reason: "EXPIRED" };
    const { consumedAt: _consumed, ...clean } = record;
    return checkBinding(clean, input);
  }

  async purgeExpired(now: string): Promise<number> {
    let count = 0;
    for (const [key, record] of this.states) {
      if (record.expiresAt <= now || record.consumedAt) {
        this.states.delete(key);
        count += 1;
      }
    }
    return count;
  }
}

type StateRow = { state_hash: string; provider: string; tenant_id: string; workspace_id: string; user_id: string | null; network: string | null; return_path: string | null; code_verifier: string | null; created_at: Date; expires_at: Date; consumed_at: Date | null };

/** Compartilhado entre instâncias da API; consumo atômico com UPDATE ... WHERE consumed_at IS NULL. */
export class PostgresOAuthStateStore implements OAuthStateStorePort {
  constructor(private readonly pool: Pool) {}

  async create(state: string, record: OAuthStateRecord): Promise<void> {
    await this.pool.query(
      `insert into oauth_states (state_hash, provider, tenant_id, workspace_id, user_id, network, return_path, code_verifier, created_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [hashOAuthState(state), record.provider, record.tenantId, record.workspaceId, record.userId ?? null, record.network ?? null, record.returnPath ?? null, record.codeVerifier ?? null, record.createdAt, record.expiresAt],
    );
  }

  async consume(input: { state: string; provider: string; now: string; tenantId?: string; userId?: string }): Promise<OAuthStateConsumeResult> {
    const hash = hashOAuthState(input.state);
    // Uso único atômico: só UMA requisição vence a corrida; o verificador PKCE é apagado no ato.
    const result = await this.pool.query<StateRow>(
      `with target as (select * from oauth_states where state_hash = $1 for update)
       update oauth_states s set consumed_at = $2, code_verifier = null
       from target where s.state_hash = target.state_hash and target.consumed_at is null
       returning target.*`,
      [hash, input.now],
    );
    const row = result.rows[0];
    if (!row) {
      const existing = await this.pool.query<{ consumed_at: Date | null }>("select consumed_at from oauth_states where state_hash = $1", [hash]);
      return { ok: false, reason: existing.rows[0] ? "ALREADY_CONSUMED" : "NOT_FOUND" };
    }
    if (row.expires_at.toISOString() <= input.now) return { ok: false, reason: "EXPIRED" };
    return checkBinding({
      provider: row.provider,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      ...(row.user_id ? { userId: row.user_id } : {}),
      ...(row.network ? { network: row.network } : {}),
      ...(row.return_path ? { returnPath: row.return_path } : {}),
      ...(row.code_verifier ? { codeVerifier: row.code_verifier } : {}),
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    }, input);
  }

  async purgeExpired(now: string): Promise<number> {
    const result = await this.pool.query("delete from oauth_states where expires_at <= $1 or (consumed_at is not null and consumed_at <= $1::timestamptz - interval '1 day')", [now]);
    return result.rowCount ?? 0;
  }
}
