-- PlanningDecision — Sprint 09. Trilha de explicabilidade do Arthur Planner (mesmo espírito de
-- UserIntent.matchedRule / ArthurDecision.reason já usados desde a Sprint 06).
create table planning_decisions (
  id                  text primary key,
  planning_id         text not null references planning (id) on delete cascade,
  decision_code       text not null,
  reason              text not null,
  related_task_ids    text[] not null default '{}',
  created_at          timestamptz not null
);

create index planning_decisions_planning_id_idx on planning_decisions (planning_id);
