-- RuntimeBinding — Sprint 10 (decisão obrigatória 19). fromOutputPort -> toInputPort. Cardinalidade
-- 1:1 por porta de entrada garantida também no banco (defesa em profundidade, além da validação em
-- application/runtime/validation.ts): no máximo um binding pode alimentar a mesma porta de entrada.
create table runtime_bindings (
  id                     text primary key,
  runtime_plan_id        text not null references runtime_plans (id) on delete cascade,
  from_runtime_task_id   text not null references runtime_tasks (id) on delete cascade,
  from_output_port       text not null,
  to_runtime_task_id     text not null references runtime_tasks (id) on delete cascade,
  to_input_port          text not null,
  created_at             timestamptz not null,

  constraint runtime_bindings_no_self_loop check (from_runtime_task_id <> to_runtime_task_id)
);

create unique index runtime_bindings_to_input_port_uq on runtime_bindings (to_runtime_task_id, to_input_port);
create index runtime_bindings_plan_id_idx on runtime_bindings (runtime_plan_id);
