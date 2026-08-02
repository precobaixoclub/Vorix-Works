-- RuntimeArtifact — Sprint 10 (decisão obrigatória 23/24). O que uma RuntimeTask DEVERIA produzir
-- — nunca o que produziu de fato (nada é gerado nesta sprint; status só alcança 'expected').
-- `ArtifactSchema` (domínio Runtime) é separado de `ArtifactContract` (domínio Planning) de
-- propósito — colunas próprias, mesmo que o tradutor só copie os valores 1:1 nesta sprint.
create table runtime_artifacts (
  id                  text primary key,
  runtime_plan_id     text not null references runtime_plans (id) on delete cascade,
  runtime_task_id     text not null references runtime_tasks (id) on delete cascade,
  artifact_type       text not null,
  description         text not null,
  expected_fields     text[] not null default '{}',
  status              text not null,
  created_at          timestamptz not null,

  constraint runtime_artifacts_artifact_type_check check (artifact_type in ('text', 'image', 'video', 'carousel', 'document')),
  constraint runtime_artifacts_status_check check (status in ('expected'))
);

create index runtime_artifacts_plan_id_idx on runtime_artifacts (runtime_plan_id);
