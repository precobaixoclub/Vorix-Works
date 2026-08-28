import type {
  CreateMessagingConnectionInput,
  MessagingConnectionRepositoryPort,
  UpdateMessagingConnectionStatusInput,
} from "../../application/ports/messaging-connection-repository.port.js";
import type { MessagingConnection } from "../../domain/inbox/inbox.model.js";
import { MESSAGING_CONNECTION_TERMINAL_STATUSES } from "../../domain/inbox/inbox.model.js";

const idGenerator = () => `msgconn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryMessagingConnectionRepository implements MessagingConnectionRepositoryPort {
  private readonly rows = new Map<string, MessagingConnection>();

  async create(input: CreateMessagingConnectionInput): Promise<MessagingConnection> {
    const now = new Date().toISOString();
    const connection: MessagingConnection = {
      id: idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      displayName: input.displayName,
      status: "connecting",
      connectionHealth: "unknown",
      reconnectCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(connection.id, connection);
    return connection;
  }

  async getById(id: string): Promise<MessagingConnection | undefined> {
    return this.rows.get(id);
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MessagingConnection[]> {
    return [...this.rows.values()]
      .filter((row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAllActive(): Promise<MessagingConnection[]> {
    return [...this.rows.values()].filter((row) => !MESSAGING_CONNECTION_TERMINAL_STATUSES.includes(row.status));
  }

  async updateStatus(id: string, input: UpdateMessagingConnectionStatusInput): Promise<MessagingConnection> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`MESSAGING_CONNECTION_NOT_FOUND: conexão "${id}" não existe.`);
    const now = new Date().toISOString();
    const updated: MessagingConnection = {
      ...existing,
      status: input.status,
      connectionHealth: input.connectionHealth ?? existing.connectionHealth,
      externalSessionId: input.externalSessionId ?? existing.externalSessionId,
      phoneNumber: input.phoneNumber ?? existing.phoneNumber,
      reconnectCount: input.incrementReconnectCount ? existing.reconnectCount + 1 : existing.reconnectCount,
      updatedAt: now,
      lastConnectedAt: input.status === "connected" ? now : existing.lastConnectedAt,
      lastDisconnectedAt: input.status === "disconnected" ? now : existing.lastDisconnectedAt,
    };
    this.rows.set(id, updated);
    return updated;
  }

  async touchEvent(id: string, at: string): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, { ...existing, lastEventAt: at });
  }

  async touchHeartbeat(id: string, at: string): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, { ...existing, lastHeartbeatAt: at });
  }
}
