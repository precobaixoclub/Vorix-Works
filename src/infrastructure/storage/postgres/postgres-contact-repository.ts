import type { Pool } from "pg";
import type { ContactRepositoryPort, CreateContactInput, UpdateContactInput } from "../../../application/ports/contact-repository.port.js";
import type { Contact } from "../../../domain/crm/crm.model.js";

const idGenerator = () => `contact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type ContactRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  name: string;
  company: string | null;
  document: string | null;
  origin: string | null;
  owner_user_id: string | null;
  team_id: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  last_interaction_at: Date | null;
};

export class PostgresContactRepository implements ContactRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateContactInput): Promise<Contact> {
    const result = await this.pool.query<ContactRow>(
      `insert into contacts (id, tenant_id, workspace_id, name, company, document, origin, owner_user_id, team_id, tags, custom_fields, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning *`,
      [
        idGenerator(), input.tenantId, input.workspaceId, input.name,
        input.company ?? null, input.document ?? null, input.origin ?? null,
        input.ownerUserId ?? null, input.teamId ?? null,
        JSON.stringify(input.tags ?? []), JSON.stringify(input.customFields ?? {}), input.notes ?? null,
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Contact | undefined> {
    const result = await this.pool.query<ContactRow>("select * from contacts where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; search?: string; ownerUserId?: string; teamId?: string; cursor?: string; limit?: number }): Promise<Contact[]> {
    const limit = input.limit ?? 50;
    const conditions: string[] = ["tenant_id = $1", "workspace_id = $2"];
    const params: unknown[] = [input.tenantId, input.workspaceId];
    if (input.search) {
      params.push(`%${input.search}%`);
      conditions.push(`name ilike $${params.length}`);
    }
    if (input.ownerUserId) {
      params.push(input.ownerUserId);
      conditions.push(`owner_user_id = $${params.length}`);
    }
    if (input.teamId) {
      params.push(input.teamId);
      conditions.push(`team_id = $${params.length}`);
    }
    if (input.cursor) {
      params.push(input.cursor);
      conditions.push(`created_at < (select created_at from contacts where id = $${params.length})`);
    }
    params.push(limit);
    const result = await this.pool.query<ContactRow>(
      `select * from contacts where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async countByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "select count(*) as count from contacts where tenant_id = $1 and workspace_id = $2",
      [input.tenantId, input.workspaceId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async update(id: string, input: UpdateContactInput): Promise<Contact> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`CONTACT_NOT_FOUND: contato "${id}" não existe.`);
    const result = await this.pool.query<ContactRow>(
      `update contacts set
         name = $2, company = $3, document = $4, origin = $5, owner_user_id = $6, team_id = $7,
         tags = $8, custom_fields = $9, notes = $10, updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        input.name ?? existing.name,
        input.company ?? existing.company ?? null,
        input.document ?? existing.document ?? null,
        input.origin ?? existing.origin ?? null,
        input.ownerUserId ?? existing.ownerUserId ?? null,
        input.teamId ?? existing.teamId ?? null,
        JSON.stringify(input.tags ?? existing.tags),
        JSON.stringify(input.customFields ?? existing.customFields),
        input.notes ?? existing.notes ?? null,
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  async touchLastInteraction(id: string, occurredAt: string): Promise<void> {
    await this.pool.query("update contacts set last_interaction_at = $2, updated_at = now() where id = $1", [id, occurredAt]);
  }

  private toDomain(row: ContactRow): Contact {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      name: row.name,
      company: row.company ?? undefined,
      document: row.document ?? undefined,
      origin: row.origin ?? undefined,
      ownerUserId: row.owner_user_id ?? undefined,
      teamId: row.team_id ?? undefined,
      tags: row.tags ?? [],
      customFields: row.custom_fields ?? {},
      notes: row.notes ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      lastInteractionAt: row.last_interaction_at?.toISOString(),
    };
  }
}
