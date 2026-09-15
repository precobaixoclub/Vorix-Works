/** Central de notificações in-app ("sino"), réplica adaptada do CMDesk — espelha
 * `Notification` do backend (`src/domain/notification/notification.model.ts`). Não confundir com
 * a OUTRA "Central de Notificações" do relatório de referência (disparo em massa de WhatsApp),
 * fora de escopo desta rodada. */
export type Notification = {
  id: string;
  userId: string;
  title: string;
  body?: string;
  sourceType: string;
  sourceId?: string;
  sourceUrl?: string;
  readAt?: string;
  dismissedAt?: string;
  createdAt: string;
};

export type NotificationStreamToken = { streamToken: string; expiresIn: number };
