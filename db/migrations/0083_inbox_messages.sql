-- 0083 — Módulo Conversas (Fase 1): mensagens individuais. `unique (connection_id,
-- external_message_id)` é a trava de idempotência principal contra reentrega de evento (WuzAPI/
-- RabbitMQ pode entregar o mesmo evento mais de uma vez) — ver Fase 2 (Eventos).

create table if not exists inbox_messages (
  id                   text primary key,
  tenant_id            text not null,
  workspace_id         text not null references workspaces (id) on delete cascade,
  conversation_id      text not null references inbox_conversations (id) on delete cascade,
  connection_id        text not null references messaging_connections (id) on delete cascade,
  -- Nulo enquanto a mensagem outbound está só "queued" (ainda não foi enviada ao provider).
  external_message_id  text,
  direction            text not null check (direction in ('inbound', 'outbound')),
  type                 text not null default 'text' check (type in ('text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'other')),
  status               text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed')),
  body                 text,
  media_storage_ref    jsonb,
  mime_type            text,
  metadata             jsonb,
  sent_by_user_id      text,
  sent_by_ai           boolean not null default false,
  sent_by_automation   boolean not null default false,
  attempt_count        integer not null default 0,
  last_error           text,
  last_attempt_at      timestamptz,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  delivered_at         timestamptz,
  read_at              timestamptz,
  failed_at            timestamptz,

  unique (connection_id, external_message_id)
);

create index if not exists inbox_messages_conversation_idx on inbox_messages (conversation_id, created_at desc);
create index if not exists inbox_messages_tenant_workspace_idx on inbox_messages (tenant_id, workspace_id);
create index if not exists inbox_messages_status_idx on inbox_messages (status);
