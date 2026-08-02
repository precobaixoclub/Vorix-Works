-- RuntimeTaskInputPort — Sprint 10 (decisão obrigatória 17/19). Porta de entrada de uma
-- RuntimeTask — o que ela espera consumir, nunca o que ela produz (ver runtime_task_outputs).
create table runtime_task_inputs (
  id                        text primary key,
  runtime_plan_id           text not null references runtime_plans (id) on delete cascade,
  runtime_task_id           text not null references runtime_tasks (id) on delete cascade,
  port_key                  text not null,
  accepted_artifact_types   text[] not null,
  required                  boolean not null,
  description               text not null,
  created_at                timestamptz not null
);

-- Uma porta de entrada por chave, por tarefa.
create unique index runtime_task_inputs_task_port_uq on runtime_task_inputs (runtime_task_id, port_key);
create index runtime_task_inputs_plan_id_idx on runtime_task_inputs (runtime_plan_id);
