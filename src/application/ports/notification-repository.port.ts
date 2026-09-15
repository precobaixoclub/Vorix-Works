import type { Notification } from "../../domain/notification/notification.model.js";

export type CreateNotificationInput = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  title: string;
  body?: string;
  sourceType: string;
  sourceId?: string;
  sourceUrl?: string;
};

export type NotificationRepositoryPort = {
  create(input: CreateNotificationInput): Promise<Notification>;
  /** Até `limit`, mais recentes primeiro, excluindo dispensadas — o sino "Novas". */
  listActive(input: { tenantId: string; workspaceId: string; userId: string; limit: number }): Promise<Notification[]>;
  /** Até `limit`, mais recentes primeiro, incluindo já dispensadas — o histórico. */
  listHistory(input: { tenantId: string; workspaceId: string; userId: string; limit: number }): Promise<Notification[]>;
  /** `readAt`+`dismissedAt` setados juntos (ver `Notification`). `undefined` se não existir ou for
   * de outro tenant/workspace/usuário — nunca lança, o caller decide o 404. */
  dismiss(input: { tenantId: string; workspaceId: string; userId: string; id: string }): Promise<Notification | undefined>;
  /** Marca todas as ativas (não dispensadas) do usuário; devolve quantas foram afetadas. */
  dismissAll(input: { tenantId: string; workspaceId: string; userId: string }): Promise<number>;
};
