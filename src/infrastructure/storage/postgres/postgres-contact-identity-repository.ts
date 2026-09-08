import type { Pool } from "pg";
import type { ContactIdentityRepositoryPort, CreateContactIdentityInput } from "../../../application/ports/contact-identity-repository.port.js";
import type { ContactChannel, ContactIdentity } from "../../../domain/crm/crm.model.js";

const idGenerator = () => `identity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type IdentityRow = {
  id: string;
  contact_id: string;
  tenant_id: string;
  workspace_id: string;
  channel: string;
  external_id: string;
  connection_id: string | null;
  created_at: Date;
};

export class PostgresContactIdentityRepository implements ContactIdentityRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateContactIdentityInput): Promise<{ identity: ContactIdentity; wasCreated: boolean }> {
    const insertResult = await this.pool.query<IdentityRow>(
      `insert into contact_identities (id, contact_id, tenant_id, workspace_id, channel, external_id, connection_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (channel, external_id) do nothing
       returning *`,
      [idGenerator(), input.contactId, input.tenantId, input.workspaceId, input.channel, input.externalId, input.connectionId ?? null],
    );
    if (insertResult.rows[0]) {
      // WhatsApp — mantém `inbox_contacts.contact_id` (Fase 1, migration 0092) em sincronia com
      // `contact_identities`. Só preenche se ainda `null` (nunca sobrescreve/funde sem sinal
      // explícito — mesmo racional de `contact_identities` em si).
      if (input.channel === "whatsapp") {
        await this.pool.query("update inbox_contacts set contact_id = $1 where id = $2 and contact_id is null", [input.contactId, input.externalId]);
      }
      return { identity: this.toDomain(insertResult.rows[0]), wasCreated: true };
    }
    const existing = await this.pool.query<IdentityRow>(
      "select * from contact_identities where channel = $1 and external_id = $2",
      [input.channel, input.externalId],
    );
    return { identity: this.toDomain(existing.rows[0]), wasCreated: false };
  }

  async listByContact(contactId: string): Promise<ContactIdentity[]> {
    const result = await this.pool.query<IdentityRow>("select * from contact_identities where contact_id = $1 order by created_at asc", [contactId]);
    return result.rows.map((row) => this.toDomain(row));
  }

  async findByChannelAndExternalId(channel: ContactChannel, externalId: string): Promise<ContactIdentity | undefined> {
    const result = await this.pool.query<IdentityRow>("select * from contact_identities where channel = $1 and external_id = $2", [channel, externalId]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  private toDomain(row: IdentityRow): ContactIdentity {
    return {
      id: row.id,
      contactId: row.contact_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      channel: row.channel as ContactChannel,
      externalId: row.external_id,
      connectionId: row.connection_id ?? undefined,
      createdAt: row.created_at.toISOString(),
    };
  }
}
