-- Planning — Sprint 09. Container do plano operacional derivado de um PreparedCommand (Sprint
-- 07), nunca executado. Totalmente independente do pipeline legado (execution_plan/Caio não
-- existem em Postgres — o legado usa armazenamento em JSON, fora do banco).
create table planning (
  id                          text primary key,
  tenant_id                   text not null,
  workspace_id                text not null references workspaces (id) on delete cascade,
  conversation_id             text not null references conversations (id) on delete cascade,
  briefing_id                 text not null references briefings (id) on delete cascade,
  prepared_command_id         text not null references prepared_commands (id) on delete cascade,
  prepared_command_revision   int not null,
  status                      text not null,
  planner_version             int not null,
  planner_strategy            text not null,
  planning_template           text not null,
  graph_version               int not null,
  graph_type                  text not null,
  validation_report           jsonb not null,
  created_at                  timestamptz not null,
  updated_at                  timestamptz not null,
  superseded_at               timestamptz,

  constraint planning_status_check check (status in ('draft', 'ready', 'failed', 'superseded')),
  constraint planning_graph_type_check check (graph_type in ('dag'))
);

-- Unicidade lógica exigida (decisão obrigatória): confirmação repetida do mesmo
-- PreparedCommand/revisão nunca cria um segundo Planning — mesmo padrão de
-- prepared_commands_briefing_revision_type_uq (Sprint 07).
create unique index planning_prepared_command_revision_uq on planning (prepared_command_id, prepared_command_revision);

-- Consulta principal: listar plannings de um workspace (e opcionalmente de uma conversa).
create index planning_tenant_workspace_created_idx on planning (tenant_id, workspace_id, created_at desc);
create index planning_conversation_id_idx on planning (conversation_id);
