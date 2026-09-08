-- 0094 — CRM/Comercial, Fase 2: Pipelines e Etapas. Configuráveis por workspace (nunca hardcoded)
-- — um pipeline padrão é criado sob demanda pela aplicação na primeira leitura, nunca semeado
-- aqui (multi-tenant: não há "o" tenant pra semear). O índice único parcial garante no máximo um
-- pipeline padrão por workspace mesmo sob concorrência (ver `ensureDefaultPipeline`).

create table if not exists pipelines (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  name         text not null,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists pipelines_tenant_workspace_idx on pipelines (tenant_id, workspace_id);
create unique index if not exists pipelines_default_per_workspace_idx on pipelines (workspace_id) where is_default;

create table if not exists pipeline_stages (
  id          text primary key,
  pipeline_id text not null references pipelines (id) on delete cascade,
  name        text not null,
  position    integer not null,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (pipeline_id, position)
);

create index if not exists pipeline_stages_pipeline_idx on pipeline_stages (pipeline_id);
