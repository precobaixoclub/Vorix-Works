/**
 * Product Analytics — fundação de eventos de produto. Propositalmente DISTINTA de:
 *   - Timeline do CRM (`domain/crm/`) — histórico de um Contato/Negócio específico.
 *   - Analytics de Marketing/conteúdo (`domain/analytics/`) — pipeline de planning/execution/
 *     publication, union fechado próprio, sem noção de anônimo/sessão/funil de produto.
 *   - Audit Log (`application/ports/audit-log.port.ts`) — segurança/sessão, "só estrutura, sem
 *     dashboard", por design.
 *   - BillingEvent (`domain/platform-billing/billing-ops.model.ts`) — auditoria de MUDANÇA DE
 *     ESTADO de billing (o que já existia antes desta fase, continua sendo a fonte de verdade
 *     para status/plano/pagamento — Product Analytics NUNCA duplica essa autoridade, só observa).
 *
 * Vocabulário de eventos FECHADO — nunca uma string livre vinda do cliente vira um evento novo
 * sem passar por este arquivo primeiro (mesmo racional de `PLAN_LIMIT_RESOURCES`/
 * `BILLING_EVENT_TYPES`).
 */

export const PRODUCT_EVENT_NAMES = [
  "landing_view",
  "pricing_view",
  "plan_selected",
  "signup_started",
  "signup_completed",
  "trial_started",
  "trial_expired",
  "trial_converted",
  "checkout_started",
  "checkout_completed",
  "payment_failed",
  "workspace_created",
  "onboarding_started",
  "onboarding_step_completed",
  "onboarding_completed",
  "first_channel_connected",
  "first_team_member_invited",
  "first_conversation_received",
  "first_conversation_replied",
  "first_deal_created",
  "first_deal_won",
  "first_proposal_created",
  "first_proposal_sent",
  "first_proposal_accepted",
  "first_content_created",
  "first_content_published",
  "subscription_upgraded",
  "subscription_downgraded",
  "subscription_canceled",
  "subscription_reactivated",
] as const;
export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

/** Eventos "primeira vez" — idempotentes por `(workspaceId, eventName)` via
 * `product_event_firsts` (nunca por contagem/best-effort). Ver `recordFirstEvent`. */
export const FIRST_PRODUCT_EVENT_NAMES = [
  "first_channel_connected",
  "first_team_member_invited",
  "first_conversation_received",
  "first_conversation_replied",
  "first_deal_created",
  "first_deal_won",
  "first_proposal_created",
  "first_proposal_sent",
  "first_proposal_accepted",
  "first_content_created",
  "first_content_published",
] as const satisfies readonly ProductEventName[];
export type FirstProductEventName = (typeof FIRST_PRODUCT_EVENT_NAMES)[number];

export const PRODUCT_EVENT_SOURCES = ["client", "server"] as const;
export type ProductEventSource = (typeof PRODUCT_EVENT_SOURCES)[number];

/** Marcos usados pra medir "por onde o cliente realmente passou" (seção 15/16 do pedido) — cada
 * um mapeia pra um `ProductEventName` já instrumentado, nunca uma métrica nova inventada aqui. */
export const ACTIVATION_MILESTONE_EVENTS = [
  "onboarding_completed",
  "first_channel_connected",
  "first_conversation_received",
  "first_deal_created",
  "first_proposal_created",
  "first_content_created",
] as const satisfies readonly ProductEventName[];

export type ProductEvent = {
  id: string;
  eventName: ProductEventName;
  occurredAt: string;
  receivedAt: string;
  anonymousId?: string;
  userId?: string;
  tenantId?: string;
  workspaceId?: string;
  sessionId?: string;
  source: ProductEventSource;
  properties: Record<string, unknown>;
  schemaVersion: number;
};
