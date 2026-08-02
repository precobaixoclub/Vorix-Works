-- PlanningEdge — Sprint 09. "A depende de B" (Fase 6) — always kind='depends_on' nesta sprint.
create table planning_edges (
  id             text primary key,
  planning_id    text not null references planning (id) on delete cascade,
  from_node_id   text not null references planning_nodes (id) on delete cascade,
  to_node_id     text not null references planning_nodes (id) on delete cascade,
  kind           text not null,
  created_at     timestamptz not null,

  constraint planning_edges_kind_check check (kind in ('depends_on')),
  constraint planning_edges_no_self_loop check (from_node_id <> to_node_id)
);

create unique index planning_edges_unique_edge_uq on planning_edges (planning_id, from_node_id, to_node_id, kind);
create index planning_edges_planning_id_idx on planning_edges (planning_id);
