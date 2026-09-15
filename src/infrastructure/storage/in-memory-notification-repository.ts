import type { CreateNotificationInput, NotificationRepositoryPort } from "../../application/ports/notification-repository.port.js";
import type { Notification } from "../../domain/notification/notification.model.js";

const idGenerator = () => `notif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryNotificationRepository implements NotificationRepositoryPort {
  private readonly rows: Notification[] = [];

  async create(input: CreateNotificationInput): Promise<Notification> {
    const notification: Notification = { id: idGenerator(), createdAt: new Date().toISOString(), ...input };
    this.rows.push(notification);
    return notification;
  }

  async listActive(input: { tenantId: string; workspaceId: string; userId: string; limit: number }): Promise<Notification[]> {
    return this.rows
      .filter((row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && row.userId === input.userId && !row.dismissedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit);
  }

  async listHistory(input: { tenantId: string; workspaceId: string; userId: string; limit: number }): Promise<Notification[]> {
    return this.rows
      .filter((row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && row.userId === input.userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit);
  }

  async dismiss(input: { tenantId: string; workspaceId: string; userId: string; id: string }): Promise<Notification | undefined> {
    const row = this.rows.find((n) => n.id === input.id && n.tenantId === input.tenantId && n.workspaceId === input.workspaceId && n.userId === input.userId);
    if (!row) return undefined;
    const now = new Date().toISOString();
    row.readAt = row.readAt ?? now;
    row.dismissedAt = now;
    return row;
  }

  async dismissAll(input: { tenantId: string; workspaceId: string; userId: string }): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    for (const row of this.rows) {
      if (row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && row.userId === input.userId && !row.dismissedAt) {
        row.readAt = row.readAt ?? now;
        row.dismissedAt = now;
        count += 1;
      }
    }
    return count;
  }
}
