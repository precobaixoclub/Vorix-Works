-- ExecutionTask — Sprint 09. O conteúdo de uma tarefa do plano. `sequence_hint` é só sugestão
-- visual (nunca decide precedência — isso vem sempre do DAG via planning_edges).
create table execution_tasks (
  id                      text primary key,
  planning_id             text not null references planning (id) on delete cascade,
  type                    text not null,
  name                    text not null,
  description             text not null,
  capability              text not null,
  expected_artifact_type  text not null,
  status                  text not null,
  sequence_hint           int not null,
  created_at              timestamptz not null,

  constraint execution_tasks_type_check check (type in ('research', 'campaign_structure', 'copy_generation', 'visual_generation', 'approval', 'publication')),
  constraint execution_tasks_capability_check check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution')),
  constraint execution_tasks_expected_artifact_type_check check (expected_artifact_type in ('text', 'image', 'video', 'carousel', 'document')),
  constraint execution_tasks_status_check check (status in ('planned'))
);

create index execution_tasks_planning_id_idx on execution_tasks (planning_id, sequence_hint);
