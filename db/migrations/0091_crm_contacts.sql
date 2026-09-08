-- 0091 — CRM/Comercial, Fase 1: Contato 360°. A "pessoa", separada de qualquer canal específico —
-- ver 0092 para `contact_identities` (por canal) e o backfill que liga aos `inbox_contacts`
-- (WhatsApp) já existentes SEM alterar a tabela deles nem sua FK com `inbox_conversations`.

create table if not exists contacts (
  id                     text primary key,
  tenant_id              text not null,
  workspace_id           text not null references workspaces (id) on delete cascade,
  name                   text not null,
  company                text,
  document               text,
  origin                 text,
  owner_user_id          text,
  team_id                text references teams (id) on delete set null,
  tags                   jsonb not null default '[]',
  custom_fields          jsonb not null default '{}',
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  last_interaction_at    timestamptz
);

create index if not exists contacts_tenant_workspace_idx on contacts (tenant_id, workspace_id);
create index if not exists contacts_owner_idx on contacts (owner_user_id) where owner_user_id is not null;
create index if not exists contacts_team_idx on contacts (team_id) where team_id is not null;
