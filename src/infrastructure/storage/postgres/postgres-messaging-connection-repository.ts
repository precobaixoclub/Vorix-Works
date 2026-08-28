import type { Pool } from "pg";
import type {
  CreateMessagingConnectionInput,
  MessagingConnectionRepositoryPort,
  UpdateMessagingConnectionStatusInput,
} from "../../../application/ports/messaging-connection-repository.port.js";
import type { MessagingConnection } from "../../../domain/inbox/inbox.model.js";
import { MESSAGING_CONNECTION_TERMINAL_STATUSES } from "../../../domain/inbox/inbox.model.js";

const idGenerator = () => `msgconn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  provider: string;
  display_name: string;
  phone_number: string | null;
  external_session_id: string | null;
  status: string;
  connection_health: string;
  reconnect_count: number;
  created_at: Date;
  updated_at: Date;
  last_connected_at: Date | null;
  last_disconnected_at: Date | null;
  last_event_at: Date | null;
  last_heartbeat_at: Date | null;
};

export class PostgresMessagingConnectionRepository implements MessagingConnectionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateMessagingConnectionInput): Promise<MessagingConnection> {
    const id = idGenerator();
    const result = await this.pool.query<Row>(
      `insert into messaging_connections (id, tenant_id, workspace_id, provider, display_name)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [id, input.tenantId, input.workspaceId, input.provider, input.displayName],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<MessagingConnection | undefined> {
    const result = await this.pool.query<Row>("select * from messaging_connections where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MessagingConnection[]> {
    const result = await this.pool.query<Row>(
      "select * from messaging_connections where tenant_id = $1 and workspace_id = $2 order by created_at desc",
      [input.tenantId, input.workspaceId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async listAllActive(): Promise<MessagingConnection[]> {
    const result = await this.pool.query<Row>(
      "select * from messaging_connections where status <> all($1::text[])",
      [[...MESSAGING_CONNECTION_TERMINAL_STATUSES]],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async updateStatus(id: string, input: UpdateMessagingConnectionStatusInput): Promise<MessagingConnection> {
    const result = await this.pool.query<Row>(
      `update messaging_connections set
         status = $2,
         connection_health = coalesce($3, connection_health),
         external_session_id = coalesce($4, external_session_id),
         phone_number = coalesce($5, phone_number),
         reconnect_count = reconnect_count + (case when $6 then 1 else 0 end),
         updated_at = now(),
         last_connected_at = case when $2 = 'connected' then now() else last_connected_at end,
         last_disconnected_at = case when $2 = 'disconnected' then now() else last_disconnected_at end
       where id = $1
       returning *`,
      [id, input.status, input.connectionHealth ?? null, input.externalSessionId ?? null, input.phoneNumber ?? null, input.incrementReconnectCount ?? false],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`MESSAGING_CONNECTION_NOT_FOUND: conexão "${id}" não existe.`);
    return this.toDomain(row);
  }

  async touchEvent(id: string, at: string): Promise<void> {
    await this.pool.query("update messaging_connections set last_event_at = $2 where id = $1", [id, at]);
  }

  async touchHeartbeat(id: string, at: string): Promise<void> {
    await this.pool.query("update messaging_connections set last_heartbeat_at = $2 where id = $1", [id, at]);
  }

  private toDomain(row: Row): MessagingConnection {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      provider: row.provider as MessagingConnection["provider"],
      displayName: row.display_name,
      phoneNumber: row.phone_number ?? undefined,
      externalSessionId: row.external_session_id ?? undefined,
      status: row.status as MessagingConnection["status"],
      connectionHealth: row.connection_health as MessagingConnection["connectionHealth"],
      reconnectCount: row.reconnect_count,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      lastConnectedAt: row.last_connected_at?.toISOString(),
      lastDisconnectedAt: row.last_disconnected_at?.toISOString(),
      lastEventAt: row.last_event_at?.toISOString(),
      lastHeartbeatAt: row.last_heartbeat_at?.toISOString(),
    };
  }
}
