-- 0078 — Fase 5 (Instagram DM Automation): mensagens individuais do inbox de DM.

create table if not exists instagram_dm_messages (
  id                text primary key,
  tenant_id         text not null,
  workspace_id      text not null references workspaces (id) on delete cascade,
  conversation_id   text not null references instagram_dm_conversations (id) on delete cascade,
  direction         text not null check (direction in ('inbound', 'outbound')),
  sender            text not null check (sender in ('user', 'page', 'automation')),
  -- `mid` da Meta — usado pra deduplicar reentrega de webhook (Meta pode reenviar o mesmo evento).
  message_id        text,
  message_text      text,
  raw_payload       jsonb,
  sent_at           timestamptz not null,
  created_at        timestamptz not null default now(),

  unique (conversation_id, message_id)
);

create index if not exists instagram_dm_messages_conversation_idx on instagram_dm_messages (conversation_id, sent_at desc);
create index if not exists instagram_dm_messages_tenant_idx on instagram_dm_messages (tenant_id);
