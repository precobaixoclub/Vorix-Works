-- PlanningArtifact — Sprint 09. O que uma tarefa DEVERIA produzir — nunca o que produziu de fato
-- (nada é gerado nesta sprint; status só alcança 'expected').
create table planning_artifacts (
  id                  text primary key,
  planning_id         text not null references planning (id) on delete cascade,
  execution_task_id   text not null references execution_tasks (id) on delete cascade,
  expected_type       text not null,
  description         text not null,
  expected_fields     text[] not null default '{}',
  status              text not null,
  created_at          timestamptz not null,

  constraint planning_artifacts_expected_type_check check (expected_type in ('text', 'image', 'video', 'carousel', 'document')),
  constraint planning_artifacts_status_check check (status in ('expected'))
);

create index planning_artifacts_planning_id_idx on planning_artifacts (planning_id);
