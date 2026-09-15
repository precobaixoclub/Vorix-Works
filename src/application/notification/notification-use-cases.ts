import type { Notification } from "../../domain/notification/notification.model.js";
import type { CreateNotificationInput, NotificationRepositoryPort } from "../ports/notification-repository.port.js";
import type { NotificationRealtimePublisherPort } from "../ports/notification-realtime-publisher.port.js";

/**
 * Bounded context "notification" (ver `domain/notification/notification.model.ts`). `deps` é
 * injetado pelos MÓDULOS CHAMADORES (inbox, calendar, crm...) — eles nunca importam o
 * repositório/adapter diretamente, só chamam `createNotification` com o `deps.notification` que
 * já receberam via DI (mesmo racional de qualquer outra porta opcional do projeto).
 */
export type NotificationUseCaseDeps = {
  notificationRepository: NotificationRepositoryPort;
  /** `undefined` só em setups sem realtime configurado (ex.: testes) — a notificação continua
   * sendo criada e visível via polling REST, só sem o empurrão imediato do SSE. */
  realtimePublisher?: NotificationRealtimePublisherPort;
};

const ACTIVE_LIST_LIMIT = 50;
const HISTORY_LIST_LIMIT = 100;

export async function createNotification(deps: NotificationUseCaseDeps, input: CreateNotificationInput): Promise<Notification> {
  const notification = await deps.notificationRepository.create(input);
  deps.realtimePublisher?.publish(notification);
  return notification;
}

/** Ponto de extensão usado por OUTROS módulos (Inbox, Calendar, CRM...) pra publicar uma
 * notificação sem acoplar o próprio fluxo a ela — nunca lança, nunca atrasa quem chamou (mesmo
 * racional do registro de evento de auditoria do Kanban, `inbox-use-cases.ts`). `deps` é opcional
 * de propósito: um chamador sem `notificationRepository` configurado (setups sem identidade real)
 * simplesmente não notifica ninguém, em vez de exigir o módulo inteiro. */
export function notifyBestEffort(deps: Partial<NotificationUseCaseDeps> | undefined, input: CreateNotificationInput): void {
  if (!deps?.notificationRepository) return;
  createNotification({ notificationRepository: deps.notificationRepository, realtimePublisher: deps.realtimePublisher }, input).catch((error) => {
    console.warn("[notification] falha ao criar notificação (best-effort, nunca derruba o fluxo de origem):", error instanceof Error ? error.message : error);
  });
}

export type ListNotificationsInput = { tenantId: string; workspaceId: string; userId: string };

export async function listActiveNotifications(deps: NotificationUseCaseDeps, input: ListNotificationsInput): Promise<Notification[]> {
  return deps.notificationRepository.listActive({ ...input, limit: ACTIVE_LIST_LIMIT });
}

export async function listNotificationHistory(deps: NotificationUseCaseDeps, input: ListNotificationsInput): Promise<Notification[]> {
  return deps.notificationRepository.listHistory({ ...input, limit: HISTORY_LIST_LIMIT });
}

export type DismissNotificationInput = { tenantId: string; workspaceId: string; userId: string; id: string };

export async function dismissNotification(deps: NotificationUseCaseDeps, input: DismissNotificationInput): Promise<Notification> {
  const dismissed = await deps.notificationRepository.dismiss(input);
  if (!dismissed) throw new Error(`NOTIFICATION_NOT_FOUND: notificação "${input.id}" não existe.`);
  return dismissed;
}

export async function dismissAllNotifications(deps: NotificationUseCaseDeps, input: ListNotificationsInput): Promise<{ dismissed: number }> {
  const dismissed = await deps.notificationRepository.dismissAll(input);
  return { dismissed };
}
