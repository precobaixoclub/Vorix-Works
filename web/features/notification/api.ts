import { apiClient } from "@/lib/api-client";
import type { Notification, NotificationStreamToken } from "./types";

/** Central de notificações in-app ("sino"), réplica adaptada do CMDesk — SEMPRE disponível (nunca
 * atrás de um kill switch de módulo, ao contrário de `/v1/inbox/*`). */

export function listActiveNotifications(workspaceId: string): Promise<{ notifications: Notification[] }> {
  return apiClient.get<{ notifications: Notification[] }>(`/v1/notifications?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listNotificationHistory(workspaceId: string): Promise<{ notifications: Notification[] }> {
  return apiClient.get<{ notifications: Notification[] }>(`/v1/notifications/history?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function dismissNotification(workspaceId: string, id: string): Promise<Notification> {
  return apiClient.post<Notification>(`/v1/notifications/${encodeURIComponent(id)}/dismiss`, { workspaceId });
}

export function dismissAllNotifications(workspaceId: string): Promise<{ dismissed: number }> {
  return apiClient.post<{ dismissed: number }>("/v1/notifications/dismiss-all", { workspaceId });
}

/** Curtíssima duração/escopo único — mesmo racional de `mintInboxStreamToken`. */
export function mintNotificationStreamToken(): Promise<NotificationStreamToken> {
  return apiClient.post<NotificationStreamToken>("/v1/notifications/stream-token");
}
