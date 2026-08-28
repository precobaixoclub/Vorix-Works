-- 0081 — Módulo Conversas (Fase 1): contatos do inbox. `phone_normalized` (E.164) é a chave de
-- deduplicação por workspace — nunca criar um novo contato pra um telefone já normalizado igual.

create table if not exists inbox_contacts (
  id                   text primary key,
  tenant_id            text not null,
  workspace_id         text not null references workspaces (id) on delete cascade,
  name                 text,
  phone_normalized     text not null,
  profile_picture_url  text,
  external_id          text,
  metadata             jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (workspace_id, phone_normalized)
);

create index if not exists inbox_contacts_tenant_workspace_idx on inbox_contacts (tenant_id, workspace_id);
