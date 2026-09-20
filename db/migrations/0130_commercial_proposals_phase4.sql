-- Jornada Comercial Integrada, Fase 4: modelos, links rotativos, visualizações e entregas.
-- O token público bruto nunca é persistido. `proposal_views` não guarda IP, user-agent ou
-- fingerprint: uma linha significa apenas que o endpoint público foi acessado.

create table if not exists proposal_templates (
  id                  text primary key,
  tenant_id           text not null,
  workspace_id        text not null references workspaces (id) on delete cascade,
  name                text not null,
  default_title       text not null,
  default_items       jsonb not null default '[]',
  default_conditions  text,
  default_valid_days  integer not null default 7 check (default_valid_days between 1 and 3650),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists proposal_templates_workspace_idx
  on proposal_templates (tenant_id, workspace_id, active, created_at desc);

alter table proposals
  add column if not exists last_viewed_at timestamptz,
  add column if not exists view_count integer not null default 0,
  add column if not exists public_link_revoked_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists rejection_comment text;

create table if not exists proposal_views (
  id          text primary key,
  proposal_id text not null references proposals (id) on delete cascade,
  viewed_at   timestamptz not null default now()
);

create index if not exists proposal_views_proposal_idx
  on proposal_views (proposal_id, viewed_at desc);

create table if not exists proposal_deliveries (
  id                 text primary key,
  tenant_id          text not null,
  workspace_id       text not null references workspaces (id) on delete cascade,
  proposal_id        text not null references proposals (id) on delete cascade,
  conversation_id    text not null references inbox_conversations (id) on delete restrict,
  inbox_message_id   text references inbox_messages (id) on delete set null,
  idempotency_key    text not null,
  status             text not null check (status in ('pending', 'queued', 'failed')),
  error_message      text,
  created_at         timestamptz not null default now(),
  queued_at          timestamptz,
  unique (tenant_id, workspace_id, idempotency_key)
);

create index if not exists proposal_deliveries_proposal_idx
  on proposal_deliveries (proposal_id, created_at desc);
