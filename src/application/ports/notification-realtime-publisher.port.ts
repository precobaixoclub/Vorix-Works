import type { Notification } from "../../domain/notification/notification.model.js";

/** Publica no barramento realtime depois que a notificação já foi persistida com sucesso — nunca
 * a fonte de verdade (mesmo racional do `InboxRealtimeSubscriber`), só um gatilho pra revalidar
 * mais rápido. `undefined`/ausente nunca falha `createNotification` — a notificação sempre existe
 * de qualquer forma via polling REST na reconexão do sino. */
export type NotificationRealtimePublisherPort = {
  publish(notification: Notification): void;
};
