import type { Pool } from "pg";
import type { InboxIdentityLink, InboxIdentityLinkRepositoryPort, UpsertInboxIdentityLinkInput } from "../../../application/ports/inbox-identity-link-repository.port.js";

const idGenerator = () => `inboxlink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  lid: string;
  phone_e164: string;
  confidence: number;
  source: string;
  created_at: Date;
  updated_at: Date;
};

export class PostgresInboxIdentityLinkRepository implements InboxIdentityLinkRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsert(input: UpsertInboxIdentityLinkInput): Promise<InboxIdentityLink> {
    const id = idGenerator();
    // `confidence = greatest(...)` — uma nova evidência nunca rebaixa a confiança já registrada
    // (mesma regra do `IdentityLink` do sistema de referência do usuário).
    const result = await this.pool.query<Row>(
      `insert into inbox_identity_links (id, tenant_id, workspace_id, lid, phone_e164, confidence, source)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (workspace_id, lid) do update set
         phone_e164 = excluded.phone_e164,
         confidence = greatest(inbox_identity_links.confidence, excluded.confidence),
         source = excluded.source,
         updated_at = now()
       returning *`,
      [id, input.tenantId, input.workspaceId, input.lid, input.phoneE164, input.confidence, input.source],
    );
    return this.toDomain(result.rows[0]);
  }

  async getByLid(workspaceId: string, lid: string): Promise<InboxIdentityLink | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_identity_links where workspace_id = $1 and lid = $2", [workspaceId, lid]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByPhone(workspaceId: string, phoneE164: string): Promise<InboxIdentityLink[]> {
    const result = await this.pool.query<Row>("select * from inbox_identity_links where workspace_id = $1 and phone_e164 = $2", [workspaceId, phoneE164]);
    return result.rows.map((row) => this.toDomain(row));
  }

  async listUpdatedSince(workspaceId: string, sinceIso: string, limit: number): Promise<InboxIdentityLink[]> {
    const result = await this.pool.query<Row>(
      "select * from inbox_identity_links where workspace_id = $1 and updated_at >= $2 order by updated_at asc limit $3",
      [workspaceId, sinceIso, limit],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: Row): InboxIdentityLink {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      lid: row.lid,
      phoneE164: row.phone_e164,
      confidence: row.confidence,
      source: row.source,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
