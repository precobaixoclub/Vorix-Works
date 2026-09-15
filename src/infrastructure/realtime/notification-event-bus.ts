import { EventEmitter } from "node:events";
import type { Notification } from "../../domain/notification/notification.model.js";
import type { NotificationRealtimePublisherPort } from "../../application/ports/notification-realtime-publisher.port.js";

/**
 * Barramento realtime do sino de notificações — `EventEmitter` IN-PROCESS, deliberadamente mais
 * simples que o `InboxRealtimeSubscriber` (que usa RabbitMQ para fanout entre réplicas de
 * `zuno-api`). Trade-off aceito e documentado: com mais de uma réplica da API rodando, uma
 * notificação criada por uma réplica só chega via SSE a quem estiver conectado NAQUELA réplica —
 * as outras réplicas só recuperam a notificação no próximo polling REST do frontend (60s, ver
 * `useNotifications`). Nunca perde a notificação (ela já foi persistida antes de publicar aqui,
 * mesmo racional do Inbox) — só atrasa a entrega em tempo real nesse cenário específico. Decisão
 * de escopo: introduzir uma exchange RabbitMQ nova só para isto não se paga para uma feature de
 * volume baixo (1 notificação pontual por usuário, não um fluxo de mensagens de alto volume).
 */
export const notificationEventBus = new EventEmitter();
notificationEventBus.setMaxListeners(0);

export class InProcessNotificationRealtimePublisher implements NotificationRealtimePublisherPort {
  publish(notification: Notification): void {
    notificationEventBus.emit("notification", notification);
  }
}
