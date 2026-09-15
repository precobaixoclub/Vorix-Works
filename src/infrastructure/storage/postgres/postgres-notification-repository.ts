import type { Pool } from "pg";
import type { CreateNotificationInput, NotificationRepositoryPort } from "../../../application/ports/notification-repository.port.js";
import type { Notification } from "../../../domain/notification/notification.model.js";

const idGenerator = () => `notif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  body: string | null;
  source_type: string;
  source_id: string | null;
  source_url: string | null;
  read_at: Date | null;
  dismissed_at: Date | null;
  created_at: Date;
};

export class PostgresNotificationRepository implements NotificationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const result = await this.pool.query<Row>(
      `insert into notifications (id, tenant_id, workspace_id, user_id, title, body, source_type, source_id, source_url)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [idGenerator(), input.tenantId, input.workspaceId, input.userId, input.title, input.body ?? null, input.sourceType, input.sourceId ?? null, input.sourceUrl ?? null],
    );
    return this.toDomain(result.rows[0]);
  }

  async listActive(input: { tenantId: string; workspaceId: string; userId: string; limit: number }): Promise<Notification[]> {
    const result = await this.pool.query<Row>(
      `select * from notifications
       where tenant_id = $1 and workspace_id = $2 and user_id = $3 and dismissed_at is null
       order by created_at desc
       limit $4`,
      [input.tenantId, input.workspaceId, input.userId, input.limit],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async listHistory(input: { tenantId: string; workspaceId: string; userId: string; limit: number }): Promise<Notification[]> {
    const result = await this.pool.query<Row>(
      `select * from notifications
       where tenant_id = $1 and workspace_id = $2 and user_id = $3
       order by created_at desc
       limit $4`,
      [input.tenantId, input.workspaceId, input.userId, input.limit],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async dismiss(input: { tenantId: string; workspaceId: string; userId: string; id: string }): Promise<Notification | undefined> {
    const result = await this.pool.query<Row>(
      `update notifications set read_at = coalesce(read_at, now()), dismissed_at = now()
       where id = $1 and tenant_id = $2 and workspace_id = $3 and user_id = $4
       returning *`,
      [input.id, input.tenantId, input.workspaceId, input.userId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async dismissAll(input: { tenantId: string; workspaceId: string; userId: string }): Promise<number> {
    const result = await this.pool.query(
      `update notifications set read_at = coalesce(read_at, now()), dismissed_at = now()
       where tenant_id = $1 and workspace_id = $2 and user_id = $3 and dismissed_at is null`,
      [input.tenantId, input.workspaceId, input.userId],
    );
    return result.rowCount ?? 0;
  }

  private toDomain(row: Row): Notification {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      title: row.title,
      body: row.body ?? undefined,
      sourceType: row.source_type,
      sourceId: row.source_id ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      readAt: row.read_at?.toISOString(),
      dismissedAt: row.dismissed_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  }
}
