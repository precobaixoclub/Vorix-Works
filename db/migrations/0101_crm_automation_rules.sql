-- 0101 — CRM/Comercial, Fase 6: Regras de automação. Motor simples e guiado — gatilho fechado +
-- condições (E lógico só) + uma ação por regra, nunca um construtor de expressões genérico.

create table if not exists automation_rules (
  id             text primary key,
  tenant_id      text not null,
  workspace_id   text not null references workspaces (id) on delete cascade,
  name           text not null,
  trigger        text not null check (trigger in ('deal_stage_changed', 'contact_created', 'proposal_accepted', 'proposal_rejected')),
  conditions     jsonb not null default '[]',
  action         text not null check (action in ('create_task', 'add_tag', 'assign_owner', 'assign_owner_least_loaded_in_team', 'move_deal_stage')),
  action_config  jsonb not null default '{}',
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists automation_rules_tenant_workspace_idx on automation_rules (tenant_id, workspace_id);
create index if not exists automation_rules_active_trigger_idx on automation_rules (workspace_id, trigger) where active;
