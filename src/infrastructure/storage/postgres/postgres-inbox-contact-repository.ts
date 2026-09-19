import type { Pool } from "pg";
import type { InboxContactRepositoryPort, UpsertInboxContactInput } from "../../../application/ports/inbox-contact-repository.port.js";
import type { InboxContact, InboxMediaStorageRef } from "../../../domain/inbox/inbox.model.js";

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
  contact_id: string | null;
  whatsapp_pn: string | null;
  whatsapp_lid: string | null;
  merge_status: string | null;
  merged_into_contact_id: string | null;
  merged_at: Date | null;
  profile_picture_storage_ref: InboxMediaStorageRef | null;
  profile_picture_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export class PostgresInboxContactRepository implements InboxContactRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertByPhone(input: UpsertInboxContactInput): Promise<InboxContact> {
    try {
      return await this.doUpsert(input);
    } catch (error) {
      // Conflito real de identidade (seção 43 do pedido original: "NÃO auto-merge... melhor
      // duplicar temporariamente do que fundir pessoas erradas") — o mesmo alias PN/LID já está
      // gravado em OUTRO contato deste workspace (`unique index ... where whatsapp_pn/lid is not
      // null`, migration 0116). Nunca deixa isso derrubar o processamento da mensagem: registra o
      // conflito (log — nunca lançado silenciosamente pra um reprocessamento infinito) e faz o
      // upsert de novo SEM o(s) alias(es) conflitante(s), preservando o comportamento normal
      // (telefone continua a identidade canônica; só o alias técnico fica sem registrar agora).
      const code = (error as { code?: string } | undefined)?.code;
      if (code === "23505" && (input.whatsappPn || input.whatsappLid)) {
        console.warn(
          `[inbox] CONFLITO DE IDENTIDADE: alias whatsapp_pn/whatsapp_lid já pertence a outro contato no workspace "${input.workspaceId}" ` +
            `— nunca fundido automaticamente. telefone="${input.phoneNormalized}". Revisar manualmente.`,
        );
        return this.doUpsert({ ...input, whatsappPn: undefined, whatsappLid: undefined });
      }
      throw error;
    }
  }

  private async doUpsert(input: UpsertInboxContactInput): Promise<InboxContact> {
    const id = idGenerator();
    const result = await this.pool.query<Row>(
      `insert into inbox_contacts (id, tenant_id, workspace_id, phone_normalized, name, profile_picture_url, external_id, metadata, whatsapp_pn, whatsapp_lid)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (workspace_id, phone_normalized) where merge_status is null do update set
         name = coalesce(excluded.name, inbox_contacts.name),
         profile_picture_url = coalesce(excluded.profile_picture_url, inbox_contacts.profile_picture_url),
         external_id = coalesce(excluded.external_id, inbox_contacts.external_id),
         metadata = coalesce(excluded.metadata, inbox_contacts.metadata),
         whatsapp_pn = coalesce(excluded.whatsapp_pn, inbox_contacts.whatsapp_pn),
         whatsapp_lid = coalesce(excluded.whatsapp_lid, inbox_contacts.whatsapp_lid),
         updated_at = now()
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.phoneNormalized, input.name ?? null, input.profilePictureUrl ?? null, input.externalId ?? null, input.metadata ?? null,
        input.whatsappPn ?? null, input.whatsappLid ?? null,
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<InboxContact | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_contacts where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async findByPhone(input: { tenantId: string; workspaceId: string; phoneNormalized: string }): Promise<InboxContact | undefined> {
    // `merge_status is null` — nunca devolve um contato já fundido (tombstone) como se fosse o
    // registro ativo; quem chama esperaria poder escrever nele.
    const result = await this.pool.query<Row>(
      "select * from inbox_contacts where tenant_id = $1 and workspace_id = $2 and phone_normalized = $3 and merge_status is null",
      [input.tenantId, input.workspaceId, input.phoneNormalized],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async updateProfilePicture(id: string, input: { storageRef: InboxMediaStorageRef; syncedAt: string }): Promise<void> {
    await this.pool.query(
      "update inbox_contacts set profile_picture_storage_ref = $2, profile_picture_synced_at = $3, updated_at = now() where id = $1",
      [id, JSON.stringify(input.storageRef), input.syncedAt],
    );
  }

  async linkCrmContact(id: string, contactId: string): Promise<InboxContact | undefined> {
    // `where contact_id is null` — nunca sobrescreve um vínculo já existente (idempotente: uma
    // segunda chamada, ou uma corrida entre o vínculo manual e a ponte automática, nunca troca o
    // Contact já ligado por outro).
    const result = await this.pool.query<Row>(
      "update inbox_contacts set contact_id = $2, updated_at = now() where id = $1 and contact_id is null returning *",
      [id, contactId],
    );
    if (result.rows[0]) return this.toDomain(result.rows[0]);
    return this.getById(id);
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
      crmContactId: row.contact_id ?? undefined,
      whatsappPn: row.whatsapp_pn ?? undefined,
      whatsappLid: row.whatsapp_lid ?? undefined,
      mergeStatus: (row.merge_status as "merged" | null) ?? undefined,
      mergedIntoContactId: row.merged_into_contact_id ?? undefined,
      mergedAt: row.merged_at?.toISOString(),
      profilePictureStorageRef: row.profile_picture_storage_ref ?? undefined,
      profilePictureSyncedAt: row.profile_picture_synced_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
