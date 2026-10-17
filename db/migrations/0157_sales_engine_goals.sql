-- 0157 — Sales Engine (Vorix Conversas), fase 8: metas comerciais por usuário, equipe ou empresa.
-- Período mensal/trimestral/anual com início explícito (sazonalidade: cada mês tem sua própria meta,
-- nunca "anual ÷ 12"). Realizado é SEMPRE calculado a partir dos snapshots de oportunidades GANHAS
-- (closed_at no período, crédito do responsável no momento do ganho) — nada é copiado para cá.

create table if not exists sales_goals (
  id                 text primary key,
  tenant_id          text not null,
  workspace_id       text not null references workspaces (id) on delete cascade,
  scope_type         text not null check (scope_type in ('user', 'team', 'company')),
  scope_id           text,
  metric             text not null check (metric in ('sales_revenue', 'gross_margin', 'won_opportunities', 'new_customers', 'mrr', 'arr', 'activities', 'meetings', 'average_ticket')),
  period_type        text not null check (period_type in ('monthly', 'quarterly', 'annual')),
  period_start       date not null,
  target_value       bigint not null check (target_value > 0),
  currency           text not null default 'BRL',
  created_by_user_id text,
  updated_by_user_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((scope_type = 'company' and scope_id is null) or (scope_type <> 'company' and scope_id is not null))
);
create unique index if not exists sales_goals_unique_idx on sales_goals (workspace_id, scope_type, coalesce(scope_id, ''), metric, period_type, period_start);
create index if not exists sales_goals_period_idx on sales_goals (tenant_id, workspace_id, period_start);

-- "Meta atingida" notifica uma única vez por meta.
create table if not exists sales_goal_achievements (
  goal_id     text primary key references sales_goals (id) on delete cascade,
  reached_at  timestamptz not null default now(),
  deal_id     text
);

-- Histórico de alteração de meta (auditoria comercial).
create table if not exists sales_goal_changes (
  id           text primary key,
  goal_id      text not null,
  tenant_id    text not null,
  workspace_id text not null,
  changed_by   text,
  from_value   bigint,
  to_value     bigint,
  action       text not null check (action in ('created', 'updated', 'deleted')),
  changed_at   timestamptz not null default now()
);
create index if not exists sales_goal_changes_goal_idx on sales_goal_changes (goal_id, changed_at);

create index if not exists deals_closed_period_idx on deals (workspace_id, status, closed_at);
create index if not exists deals_open_forecast_idx on deals (workspace_id, expected_close_date) where status = 'open';
