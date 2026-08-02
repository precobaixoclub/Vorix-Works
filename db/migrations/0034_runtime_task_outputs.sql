-- RuntimeTaskOutputPort — Sprint 10 (decisão obrigatória 17/19). Porta de saída de uma
-- RuntimeTask — o que ela produz.
create table runtime_task_outputs (
  id                text primary key,
  runtime_plan_id   text not null references runtime_plans (id) on delete cascade,
  runtime_task_id   text not null references runtime_tasks (id) on delete cascade,
  port_key          text not null,
  artifact_type     text not null,
  description       text not null,
  created_at        timestamptz not null,

  constraint runtime_task_outputs_artifact_type_check check (artifact_type in ('text', 'image', 'video', 'carousel', 'document'))
);

create unique index runtime_task_outputs_task_port_uq on runtime_task_outputs (runtime_task_id, port_key);
create index runtime_task_outputs_plan_id_idx on runtime_task_outputs (runtime_plan_id);
