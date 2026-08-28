import type { MessagingConnection, MessagingConnectionStatus, MessagingProviderId } from "../../domain/inbox/inbox.model.js";

/** Módulo Conversas (Fase 1). Ver `db/migrations/0080_messaging_connections.sql`. */

export type CreateMessagingConnectionInput = {
  tenantId: string;
  workspaceId: string;
  provider: MessagingProviderId;
  displayName: string;
};

export type UpdateMessagingConnectionStatusInput = {
  status: MessagingConnectionStatus;
  connectionHealth?: "healthy" | "degraded" | "unknown";
  externalSessionId?: string;
  phoneNumber?: string;
  incrementReconnectCount?: boolean;
};

export type MessagingConnectionRepositoryPort = {
  create(input: CreateMessagingConnectionInput): Promise<MessagingConnection>;
  getById(id: string): Promise<MessagingConnection | undefined>;
  /** Usado pelo worker para resolver `tenantId/workspaceId/connectionId` a partir de um evento
   * bruto do gateway, que só carrega `externalSessionId` — nunca exposto a uma rota HTTP. */
  findByExternalSessionId(externalSessionId: string): Promise<MessagingConnection | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MessagingConnection[]>;
  /** Usado pelo worker/health monitor, que só tem `connectionId` (sem tenant/workspace) vindo do
   * evento de fila — nunca exposto a uma rota HTTP. */
  listAllActive(): Promise<MessagingConnection[]>;
  updateStatus(id: string, input: UpdateMessagingConnectionStatusInput): Promise<MessagingConnection>;
  touchEvent(id: string, at: string): Promise<void>;
  touchHeartbeat(id: string, at: string): Promise<void>;
};
