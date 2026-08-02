-- Log imutável de tudo que acontece numa conversa — mensagem, intenção, contexto, decisão,
-- mudança de estado. Não existe tabela "conversation_messages" separada de propósito: uma
-- mensagem é só um evento do tipo user_message/system_message (ver conversation.model.ts).
create table conversation_events (
  id                text primary key,
  conversation_id   text not null references conversations (id) on delete cascade,
  event_type        text not null,
  payload           jsonb not null,
  created_at        timestamptz not null,

  constraint conversation_events_event_type_check check (event_type in (
    'user_message', 'intent_classified', 'context_updated', 'decision_made', 'system_message', 'state_changed'
  ))
);

-- Consulta principal: histórico de uma conversa em ordem cronológica (GET .../history).
create index conversation_events_conversation_id_created_at_idx on conversation_events (conversation_id, created_at);
