-- 0086 — Módulo Conversas, Fase 6 (Resiliência/Observabilidade/Controle Operacional).
--
-- 1) messaging_connections: `last_connection_error` (novo) + `connection_health` ganha o valor
--    'gateway_unavailable' — distingue "sessão degradada" (connection_health=degraded) de
--    "o próprio container WuzAPI está inalcançável" (connection_health=gateway_unavailable),
--    requisito explícito da fase ("container WuzAPI saudável não significa sessão saudável").
-- 2) inbox_messages: `failure_category` (novo) — categoria segura (mesmo vocabulário de
--    `MessagingProviderErrorKind` + 'circuit_open'/'rate_limited_local'), nunca o erro bruto do
--    provider (isso já vai em `last_error`, mantido como está).
-- 3) operational_circuit_breakers: `scope` ganha 'messaging_provider' — reaproveita o circuit
--    breaker operacional já existente (Postgres-backed, sobrevive a restart do worker) para as
--    chamadas HTTP ao WuzAPI, em vez de criar uma segunda stack de circuit breaker só para Inbox.
-- 4) inbox_conversation_events: `type` ganha 'ai_response_skipped_insufficient_credits' — evento
--    humano-visível quando a IA não gera resposta por falta de crédito (nunca desliga a IA nem a
--    Inbox por isso).
-- 5) ai_operation_types: registra `inbox_auto_reply` como operação cobrável — sem esta linha,
--    `CreditAccountingService.checkAvailability("inbox_auto_reply", ...)` sempre devolve
--    `operation_unknown` (gap deixado explicitamente pela Fase 5).

alter table messaging_connections add column if not exists last_connection_error text;

alter table messaging_connections drop constraint if exists messaging_connections_connection_health_check;
alter table messaging_connections add constraint messaging_connections_connection_health_check
  check (connection_health in ('healthy', 'degraded', 'unknown', 'gateway_unavailable'));

alter table inbox_messages add column if not exists failure_category text;

alter table operational_circuit_breakers drop constraint if exists operational_circuit_breakers_scope_check;
alter table operational_circuit_breakers add constraint operational_circuit_breakers_scope_check
  check (scope in ('publication_provider', 'execution_handler', 'webhook', 'analytics', 'system', 'messaging_provider'));

alter table inbox_conversation_events drop constraint if exists inbox_conversation_events_type_check;
alter table inbox_conversation_events add constraint inbox_conversation_events_type_check
  check (type in (
    'assigned', 'unassigned', 'took_over', 'transferred', 'status_changed', 'ai_paused', 'ai_resumed',
    'ai_response_sent', 'ai_response_failed', 'ai_response_cancelled', 'ai_response_skipped_insufficient_credits'
  ));

insert into ai_operation_types (code, label, capability, credits_cost, default_provider_code, default_model_id)
values ('inbox_auto_reply', 'Resposta automática de atendimento (WhatsApp)', 'text_generation', 1, 'anthropic', 'claude-haiku-4-5-20251001')
on conflict (code) do nothing;
