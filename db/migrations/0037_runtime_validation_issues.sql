-- RuntimeValidationIssue — Sprint 10 (decisão obrigatória 25/26/31). Registrado nos dois caminhos
-- (RuntimePlan validado ou validation_failed) — auditoria completa de como a tradução chegou onde
-- chegou. Sem `id` no tipo de domínio (é sempre lido em conjunto, nunca referenciado por id
-- isoladamente) — chave própria só de armazenamento.
create table runtime_validation_issues (
  id                  bigserial primary key,
  runtime_plan_id     text not null references runtime_plans (id) on delete cascade,
  code                text not null,
  message             text not null,
  field               text,
  severity            text not null,
  created_at          timestamptz not null,

  constraint runtime_validation_issues_severity_check check (severity in ('error', 'warning'))
);

create index runtime_validation_issues_plan_id_idx on runtime_validation_issues (runtime_plan_id);
