import type { Pool } from "pg";
import type { CreateInboxTagInput, InboxTagRepositoryPort, UpdateInboxTagInput } from "../../../application/ports/inbox-tag-repository.port.js";
import type { InboxTag, InboxTagColor } from "../../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxtag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = { id: string; tenant_id: string; workspace_id: string; name: string; color: string; created_at: Date; updated_at: Date };

/** Bloco "etiquetas" (pedido explícito do usuário). Ver o port pra racional de cada método. */
export class PostgresInboxTagRepository implements InboxTagRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateInboxTagInput): Promise<InboxTag> {
    const result = await this.pool.query<Row>(
      `insert into inbox_tags (id, tenant_id, workspace_id, name, color)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [idGenerator(), input.tenantId, input.workspaceId, input.name, input.color ?? "emerald"],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<InboxTag | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_tags where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<InboxTag[]> {
    const result = await this.pool.query<Row>("select * from inbox_tags where workspace_id = $1 order by name asc", [workspaceId]);
    return result.rows.map((row) => this.toDomain(row));
  }

  async update(id: string, input: UpdateInboxTagInput): Promise<InboxTag> {
    const result = await this.pool.query<Row>(
      `update inbox_tags set
         name = coalesce($2, name),
         color = coalesce($3, color),
         updated_at = now()
       where id = $1
       returning *`,
      [id, input.name ?? null, input.color ?? null],
    );
    if (!result.rows[0]) throw new Error(`INBOX_TAG_NOT_FOUND: etiqueta "${id}" não existe.`);
    return this.toDomain(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from inbox_tags where id = $1", [id]);
  }

  async attachToConversation(conversationId: string, tagId: string): Promise<void> {
    await this.pool.query(
      "insert into inbox_conversation_tags (conversation_id, tag_id) values ($1, $2) on conflict (conversation_id, tag_id) do nothing",
      [conversationId, tagId],
    );
  }

  async detachFromConversation(conversationId: string, tagId: string): Promise<void> {
    await this.pool.query("delete from inbox_conversation_tags where conversation_id = $1 and tag_id = $2", [conversationId, tagId]);
  }

  async listTagsByConversationIds(conversationIds: readonly string[]): Promise<Map<string, InboxTag[]>> {
    const map = new Map<string, InboxTag[]>();
    if (conversationIds.length === 0) return map;
    const result = await this.pool.query<Row & { conversation_id: string }>(
      `select ct.conversation_id, t.*
       from inbox_conversation_tags ct
       join inbox_tags t on t.id = ct.tag_id
       where ct.conversation_id = any($1::text[])
       order by t.name asc`,
      [conversationIds],
    );
    for (const row of result.rows) {
      const list = map.get(row.conversation_id) ?? [];
      list.push(this.toDomain(row));
      map.set(row.conversation_id, list);
    }
    return map;
  }

  private toDomain(row: Row): InboxTag {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      name: row.name,
      color: row.color as InboxTagColor,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
