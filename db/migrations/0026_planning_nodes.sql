-- PlanningNode — Sprint 09. Vértice do grafo (forma), nunca dado de layout visual (decisão
-- obrigatória: sem x/y, sem posição — isso é responsabilidade só do frontend).
create table planning_nodes (
  id                  text primary key,
  planning_id         text not null references planning (id) on delete cascade,
  execution_task_id   text not null references execution_tasks (id) on delete cascade,
  label               text not null,
  created_at          timestamptz not null
);

-- Um nó por tarefa.
create unique index planning_nodes_planning_task_uq on planning_nodes (planning_id, execution_task_id);
create index planning_nodes_planning_id_idx on planning_nodes (planning_id);
