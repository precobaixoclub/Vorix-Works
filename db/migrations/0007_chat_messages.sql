-- Mensagem de uma sessão de chat. smart_question é o formato de "pergunta inteligente" (ligado ao
-- gap needs_more_context, não resolvido nesta sprint) — jsonb porque o formato ainda evolui e não
-- tem query própria hoje. Sem updated_at: mensagem é imutável após criada (não há edição nesta
-- sprint), então só created_at faz sentido.
create table chat_messages (
  id              text primary key,
  session_id      text not null references chat_sessions (id) on delete cascade,
  role            text not null,
  content         text not null,
  smart_question  jsonb,
  created_at      timestamptz not null,

  constraint chat_messages_role_check check (role in ('user', 'assistant', 'system'))
);

-- Consulta principal: listMessages(sessionId) em ordem cronológica. Inclui id no final para
-- desempate estável quando duas mensagens tiverem o mesmo created_at (ids não são sequenciais).
create index chat_messages_session_id_created_at_id_idx on chat_messages (session_id, created_at, id);
