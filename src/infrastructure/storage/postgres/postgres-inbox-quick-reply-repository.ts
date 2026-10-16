import type { Pool } from "pg";
import type { CreateInboxQuickReplyInput, InboxQuickReplyRepositoryPort, UpdateInboxQuickReplyInput } from "../../../application/ports/inbox-quick-reply-repository.port.js";
import type { InboxQuickReply } from "../../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxqr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = { id: string; tenant_id: string; workspace_id: string; shortcut: string; body: string; created_by: string | null; created_at: Date; updated_at: Date };

const isUniqueViolation = (error: unknown) => (error as { code?: string } | undefined)?.code === "23505";
const shortcutTaken = () => new Error("INBOX_QUICK_REPLY_SHORTCUT_TAKEN: já existe uma resposta rápida com este atalho.");

export class PostgresInboxQuickReplyRepository implements InboxQuickReplyRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateInboxQuickReplyInput): Promise<InboxQuickReply> {
    try {
      const result = await this.pool.query<Row>(
        `insert into inbox_quick_replies (id, tenant_id, workspace_id, shortcut, body, created_by) values ($1, $2, $3, $4, $5, $6) returning *`,
        [idGenerator(), input.tenantId, input.workspaceId, input.shortcut, input.body, input.createdBy ?? null],
      );
      return this.toDomain(result.rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) throw shortcutTaken();
      throw error;
    }
  }

  async getById(id: string): Promise<InboxQuickReply | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_quick_replies where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<InboxQuickReply[]> {
    const result = await this.pool.query<Row>("select * from inbox_quick_replies where workspace_id = $1 order by lower(shortcut) asc", [workspaceId]);
    return result.rows.map((row) => this.toDomain(row));
  }

  async update(id: string, input: UpdateInboxQuickReplyInput): Promise<InboxQuickReply> {
    try {
      const result = await this.pool.query<Row>(
        `update inbox_quick_replies set shortcut = coalesce($2, shortcut), body = coalesce($3, body), updated_at = now() where id = $1 returning *`,
        [id, input.shortcut ?? null, input.body ?? null],
      );
      if (!result.rows[0]) throw new Error(`INBOX_QUICK_REPLY_NOT_FOUND: resposta rápida "${id}" não existe.`);
      return this.toDomain(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw shortcutTaken();
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from inbox_quick_replies where id = $1", [id]);
  }

  private toDomain(row: Row): InboxQuickReply {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      shortcut: row.shortcut,
      body: row.body,
      ...(row.created_by ? { createdBy: row.created_by } : {}),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
