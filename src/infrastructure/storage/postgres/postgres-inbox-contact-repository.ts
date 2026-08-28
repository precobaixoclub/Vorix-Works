import type { Pool } from "pg";
import type { InboxContactRepositoryPort, UpsertInboxContactInput } from "../../../application/ports/inbox-contact-repository.port.js";
import type { InboxContact } from "../../../domain/inbox/inbox.model.js";

const idGenerator = () => `contact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  name: string | null;
  phone_normalized: string;
  profile_picture_url: string | null;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

export class PostgresInboxContactRepository implements InboxContactRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertByPhone(input: UpsertInboxContactInput): Promise<InboxContact> {
    const id = idGenerator();
    const result = await this.pool.query<Row>(
      `insert into inbox_contacts (id, tenant_id, workspace_id, phone_normalized, name, profile_picture_url, external_id, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (workspace_id, phone_normalized) do update set
         name = coalesce(excluded.name, inbox_contacts.name),
         profile_picture_url = coalesce(excluded.profile_picture_url, inbox_contacts.profile_picture_url),
         external_id = coalesce(excluded.external_id, inbox_contacts.external_id),
         metadata = coalesce(excluded.metadata, inbox_contacts.metadata),
         updated_at = now()
       returning *`,
      [id, input.tenantId, input.workspaceId, input.phoneNormalized, input.name ?? null, input.profilePictureUrl ?? null, input.externalId ?? null, input.metadata ?? null],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<InboxContact | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_contacts where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async findByPhone(input: { tenantId: string; workspaceId: string; phoneNormalized: string }): Promise<InboxContact | undefined> {
    const result = await this.pool.query<Row>(
      "select * from inbox_contacts where tenant_id = $1 and workspace_id = $2 and phone_normalized = $3",
      [input.tenantId, input.workspaceId, input.phoneNormalized],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  private toDomain(row: Row): InboxContact {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      name: row.name ?? undefined,
      phoneNormalized: row.phone_normalized,
      profilePictureUrl: row.profile_picture_url ?? undefined,
      externalId: row.external_id ?? undefined,
      metadata: row.metadata ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
