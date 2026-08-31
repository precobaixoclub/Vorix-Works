-- 0085 — Módulo Conversas, Fase 5 (IA de Atendimento). Três adições independentes:
--
-- 1) `inbox_conversations.ai_paused_reason` — motivo fechado (nunca texto livre) de por que
--    `ai_enabled` está falso; `ai_processing_since` — lock lógico (CAS) de geração de IA em
--    andamento, usado para serializar mensagens consecutivas do mesmo contato (ver
--    `maybeGenerateAiResponse` em `inbox-use-cases.ts`).
-- 2) `inbox_messages.ai_claim_status`/`ai_claimed_at`/`ai_response_message_id` — claim atômico
--    (CAS) por mensagem INBOUND, impedindo duas respostas de IA para a mesma mensagem sob
--    concorrência real (defesa em profundidade — a defesa principal contra duplicidade continua
--    sendo `wasCreated`/`unique (connection_id, external_message_id)`, já existente).
-- 3) `inbox_conversation_events.metadata` — payload jsonb para os 3 novos tipos de evento de IA
--    (nunca prompt/resposta bruta); o `check` de `type` é recriado para incluir os novos valores
--    (Postgres não permite alterar um `check constraint` existente in-place).

alter table inbox_conversations
  add column if not exists ai_paused_reason text check (ai_paused_reason in ('human_takeover', 'manual')),
  add column if not exists ai_processing_since timestamptz;

alter table inbox_messages
  add column if not exists ai_claim_status text check (ai_claim_status in ('processing', 'answered', 'skipped', 'failed')),
  add column if not exists ai_claimed_at timestamptz,
  add column if not exists ai_response_message_id text references inbox_messages (id);

-- Consulta principal do drenador de IA: mensagens inbound ainda não reivindicadas de uma conversa.
create index if not exists inbox_messages_unclaimed_inbound_idx
  on inbox_messages (conversation_id, created_at)
  where direction = 'inbound' and ai_claim_status is null;

alter table inbox_conversation_events add column if not exists metadata jsonb;

alter table inbox_conversation_events drop constraint if exists inbox_conversation_events_type_check;
alter table inbox_conversation_events add constraint inbox_conversation_events_type_check
  check (type in (
    'assigned', 'unassigned', 'took_over', 'transferred', 'status_changed', 'ai_paused', 'ai_resumed',
    'ai_response_sent', 'ai_response_failed', 'ai_response_cancelled'
  ));
