-- RuntimeTask — Sprint 10. 1:1 com o ExecutionTask de origem (nunca duplica nome/descrição/
-- sequenceHint, só referencia). Único status alcançável nesta sprint: 'prepared'.
create table runtime_tasks (
  id                  text primary key,
  runtime_plan_id     text not null references runtime_plans (id) on delete cascade,
  execution_task_id   text not null references execution_tasks (id) on delete cascade,
  type                text not null,
  capability          text not null,
  status              text not null,
  created_at          timestamptz not null,

  constraint runtime_tasks_type_check check (type in ('research', 'campaign_structure', 'copy_generation', 'visual_generation', 'approval', 'publication')),
  constraint runtime_tasks_capability_check check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution')),
  constraint runtime_tasks_status_check check (status in ('prepared'))
);

create unique index runtime_tasks_plan_execution_task_uq on runtime_tasks (runtime_plan_id, execution_task_id);
create index runtime_tasks_plan_id_idx on runtime_tasks (runtime_plan_id);
