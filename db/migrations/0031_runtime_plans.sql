-- RuntimePlan — Sprint 10. Container do plano traduzido a partir de um Planning (Sprint 09,
-- status "ready"), nunca executado. Totalmente independente do pipeline legado (ExecutionPlan/
-- Caio/Helena não existem em Postgres — o legado usa armazenamento em JSON, fora do banco).
-- `RuntimeSourceContext` (decisão obrigatória 14/15) vive embutido aqui como colunas — nunca uma
-- tabela própria, é um value object 1:1 imutável cujo dono único é o RuntimePlan.
create table runtime_plans (
  id                          text primary key,
  tenant_id                   text not null,
  workspace_id                text not null references workspaces (id) on delete cascade,
  conversation_id             text not null references conversations (id) on delete cascade,
  briefing_id                 text not null references briefings (id) on delete cascade,
  prepared_command_id         text not null references prepared_commands (id) on delete cascade,
  planning_id                 text not null references planning (id) on delete cascade,
  status                      text not null,
  runtime_schema_version      int not null,
  translator_version          int not null,
  translator_strategy         text not null,
  translation_template        text not null,
  source_graph_fingerprint    text not null,
  runtime_fingerprint         text,
  validation_report           jsonb not null,
  created_at                  timestamptz not null,
  updated_at                  timestamptz not null,
  superseded_at               timestamptz,

  constraint runtime_plans_status_check check (status in ('draft', 'validating', 'validated', 'validation_failed', 'superseded'))
);

-- Unicidade lógica exigida (decisão obrigatória 7): um Planning nunca produz mais de um RuntimePlan.
create unique index runtime_plans_planning_id_uq on runtime_plans (planning_id);

create index runtime_plans_tenant_workspace_created_idx on runtime_plans (tenant_id, workspace_id, created_at desc);
create index runtime_plans_conversation_id_idx on runtime_plans (conversation_id);
