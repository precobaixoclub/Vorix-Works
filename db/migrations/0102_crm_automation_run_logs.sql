-- 0102 — CRM/Comercial, Fase 6: log de execução de automação. Auditabilidade obrigatória — toda
-- avaliação de regra (mesmo quando as condições não batem) gera um registro, nunca só as que
-- executaram uma ação.

create table if not exists automation_run_logs (
  id            text primary key,
  tenant_id     text not null,
  workspace_id  text not null references workspaces (id) on delete cascade,
  rule_id       text not null references automation_rules (id) on delete cascade,
  contact_id    text references contacts (id) on delete set null,
  deal_id       text references deals (id) on delete set null,
  matched       boolean not null,
  action_taken  boolean not null,
  error         text,
  occurred_at   timestamptz not null default now()
);

create index if not exists automation_run_logs_rule_idx on automation_run_logs (rule_id, occurred_at desc);
create index if not exists automation_run_logs_tenant_workspace_idx on automation_run_logs (tenant_id, workspace_id);
