-- 0077 — Fase 5 (Instagram DM Automation): conversas do inbox de DM.

create table if not exists instagram_dm_conversations (
  id                             text primary key,
  tenant_id                      text not null,
  workspace_id                   text not null references workspaces (id) on delete cascade,
  instagram_business_account_id  text not null,
  -- id com escopo de app (IGSID) da outra pessoa na conversa — nunca o id público do Instagram.
  participant_id                 text not null,
  participant_username           text,
  last_message_at                timestamptz,
  last_message_preview           text,
  last_message_from              text not null check (last_message_from in ('user', 'page', 'automation')),
  unread                         boolean not null default true,
  -- Humano assumiu a conversa manualmente — automação de palavra-chave nunca responde aqui até
  -- ser reativada explicitamente (evita a automação brigar com o atendente).
  automation_muted                boolean not null default false,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  unique (workspace_id, instagram_business_account_id, participant_id)
);

create index if not exists instagram_dm_conversations_workspace_idx on instagram_dm_conversations (workspace_id, last_message_at desc);
create index if not exists instagram_dm_conversations_tenant_idx on instagram_dm_conversations (tenant_id);
