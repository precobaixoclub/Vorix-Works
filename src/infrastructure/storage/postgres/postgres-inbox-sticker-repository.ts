import type { Pool } from "pg";
import type { InboxSavedSticker, InboxStickerRepositoryPort } from "../../../application/ports/inbox-sticker-repository.port.js";

type Row = { id: string; tenant_id: string; workspace_id: string; object_key: string; mime_type: string; content_hash: string; size_bytes: number; created_by: string | null; created_at: Date };

const toSticker = (row: Row): InboxSavedSticker => ({
  id: row.id,
  tenantId: row.tenant_id,
  workspaceId: row.workspace_id,
  objectKey: row.object_key,
  mimeType: row.mime_type,
  contentHash: row.content_hash,
  sizeBytes: row.size_bytes,
  ...(row.created_by ? { createdBy: row.created_by } : {}),
  createdAt: row.created_at.toISOString(),
});

export class PostgresInboxStickerRepository implements InboxStickerRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(input: Omit<InboxSavedSticker, "createdAt">): Promise<{ sticker: InboxSavedSticker; created: boolean }> {
    const inserted = await this.pool.query<Row>(
      `insert into inbox_saved_stickers (id, tenant_id, workspace_id, object_key, mime_type, content_hash, size_bytes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (workspace_id, content_hash) do nothing
       returning *`,
      [input.id, input.tenantId, input.workspaceId, input.objectKey, input.mimeType, input.contentHash, input.sizeBytes, input.createdBy ?? null],
    );
    if (inserted.rows[0]) return { sticker: toSticker(inserted.rows[0]), created: true };
    const existing = await this.pool.query<Row>("select * from inbox_saved_stickers where workspace_id = $1 and content_hash = $2", [input.workspaceId, input.contentHash]);
    return { sticker: toSticker(existing.rows[0]!), created: false };
  }

  async getById(id: string): Promise<InboxSavedSticker | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_saved_stickers where id = $1", [id]);
    return result.rows[0] ? toSticker(result.rows[0]) : undefined;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; limit: number }): Promise<InboxSavedSticker[]> {
    const result = await this.pool.query<Row>("select * from inbox_saved_stickers where tenant_id = $1 and workspace_id = $2 order by created_at desc limit $3", [input.tenantId, input.workspaceId, input.limit]);
    return result.rows.map(toSticker);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from inbox_saved_stickers where id = $1", [id]);
  }
}
