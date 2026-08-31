-- 0084 — Módulo Conversas, Fase 4 (Atendimento): auditoria + timeline de eventos operacionais
-- (atribuição, transferência, pausa/reativação de IA, mudança de status). NUNCA mensagens reais —
-- só registro interno, consultado pela Inbox pra mostrar linhas discretas tipo "Fulano assumiu o
-- atendimento" sem que isso vire uma mensagem de WhatsApp de verdade.

create table if not exists inbox_conversation_events (
  id               text primary key,
  tenant_id        text not null,
  workspace_id     text not null references workspaces (id) on delete cascade,
  conversation_id  text not null references inbox_conversations (id) on delete cascade,
  type             text not null check (type in ('assigned', 'unassigned', 'took_over', 'transferred', 'status_changed', 'ai_paused', 'ai_resumed')),
  performed_by     text not null,
  from_user_id     text,
  to_user_id       text,
  from_status      text,
  to_status        text,
  created_at       timestamptz not null default now()
);

-- Consulta principal: timeline de uma conversa, em ordem cronológica.
create index if not exists inbox_conversation_events_conversation_idx on inbox_conversation_events (conversation_id, created_at);
create index if not exists inbox_conversation_events_tenant_workspace_idx on inbox_conversation_events (tenant_id, workspace_id);
