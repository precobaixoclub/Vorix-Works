-- 0095 — CRM/Comercial, Fase 2: Negócios (Deals). Ligação opcional com `contacts` (nunca
-- obrigatória — um negócio pode nascer sem contato ligado ainda) e com `teams`. Etapa
-- (`stage_id`) é `on delete restrict`: não é permitido apagar uma etapa que ainda tem negócios
-- (a aplicação deve mover os negócios antes).

create table if not exists deals (
  id                    text primary key,
  tenant_id             text not null,
  workspace_id          text not null references workspaces (id) on delete cascade,
  pipeline_id           text not null references pipelines (id) on delete cascade,
  stage_id              text not null references pipeline_stages (id) on delete restrict,
  contact_id            text references contacts (id) on delete set null,
  title                 text not null,
  value_cents           bigint not null default 0,
  currency              text not null default 'BRL',
  owner_user_id         text,
  team_id               text references teams (id) on delete set null,
  origin                text,
  loss_reason           text,
  won_at                timestamptz,
  lost_at               timestamptz,
  expected_close_date   date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  last_stage_changed_at timestamptz not null default now()
);

create index if not exists deals_tenant_workspace_idx on deals (tenant_id, workspace_id);
create index if not exists deals_pipeline_stage_idx on deals (pipeline_id, stage_id);
create index if not exists deals_owner_idx on deals (owner_user_id) where owner_user_id is not null;
create index if not exists deals_contact_idx on deals (contact_id) where contact_id is not null;
