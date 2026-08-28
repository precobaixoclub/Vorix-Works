-- 0082 — Módulo Conversas (Fase 1): uma conversa é o par (connection, contact). `ai_enabled`
-- controla a IA só NESTA conversa (nunca globalmente) — "assumir conversa" desliga aqui, ver Fase 5.

create table if not exists inbox_conversations (
  id                   text primary key,
  tenant_id            text not null,
  workspace_id         text not null references workspaces (id) on delete cascade,
  connection_id        text not null references messaging_connections (id) on delete cascade,
  contact_id           text not null references inbox_contacts (id) on delete cascade,
  status               text not null default 'open' check (status in ('open', 'pending', 'resolved', 'archived')),
  assigned_user_id     text,
  department_id        text,
  last_message_at      timestamptz,
  unread_count         integer not null default 0,
  ai_enabled           boolean not null default false,
  automation_enabled   boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (connection_id, contact_id)
);

-- Consulta principal da Inbox: lista ordenada por atividade recente, isolada por tenant/workspace.
create index if not exists inbox_conversations_workspace_activity_idx on inbox_conversations (tenant_id, workspace_id, last_message_at desc);
create index if not exists inbox_conversations_assigned_user_idx on inbox_conversations (assigned_user_id);
create index if not exists inbox_conversations_status_idx on inbox_conversations (status);
