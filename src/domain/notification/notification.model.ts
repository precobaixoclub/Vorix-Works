/**
 * Bounded context "notification" — Central de Notificações in-app (o "sino"), réplica adaptada do
 * CMDesk (pedido explícito do usuário, relatório "Agenda e Central de Notificações no CMDesk").
 *
 * ATENÇÃO — não confundir com a OUTRA feature do mesmo relatório, também chamada "Central de
 * Notificações" lá (disparo em massa de WhatsApp pra contatos externos, `NotificationCampaign`):
 * essa segunda feature ficou FORA de escopo desta rodada porque o documento-fonte foi colado
 * truncado no meio do algoritmo de disparo (sem endpoints/checklist/frontend) — decisão de escopo
 * comunicada ao usuário, não implementada aqui.
 *
 * Contexto FINO: só lê/escreve sua própria tabela. Nunca importa de dentro de inbox/crm/calendar/
 * execution — é o INVERSO: esses módulos importam `createNotification` (application) pra publicar
 * um alerta, notification nunca sabe o que está por trás do `sourceType`/`sourceId` que recebe.
 */
export type Notification = {
  id: string;
  tenantId: string;
  workspaceId: string;
  /** Destinatário — sempre 1 usuário interno do tenant, nunca um contato externo (isso é a OUTRA
   * "Central de Notificações", fora de escopo — ver comentário acima). */
  userId: string;
  title: string;
  body?: string;
  /** String livre, catálogo aberto — cada módulo chamador escolhe a sua (ex.: `"inbox_conversation_assigned"`).
   * Nunca validado contra um enum fechado: notification não conhece os módulos que a chamam. */
  sourceType: string;
  sourceId?: string;
  /** Deep-link do frontend pra abrir o registro de origem ao clicar na notificação. */
  sourceUrl?: string;
  /** `readAt` e `dismissedAt` são sempre setados JUNTOS (mesmo achado do CMDesk) — não existe
   * "marcar como lida sem dispensar" nesta rodada; simplificação deliberada em relação ao
   * original (que também tinha like/dislike de reação, fora de escopo aqui por falta de um
   * consumidor real no Vorix hoje). */
  readAt?: string;
  dismissedAt?: string;
  createdAt: string;
};
