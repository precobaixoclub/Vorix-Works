-- 0174 — SLA de atendimento (prazo operacional; nunca confundir com CSAT/satisfação). Uma política
-- por escopo: empresa (workspace), equipe ou canal. Mais específica vence: canal > equipe > empresa.
-- `null` em um prazo = sem meta para aquele prazo naquele escopo (herda do escopo mais geral).
create table if not exists inbox_sla_policies (
  id                      text primary key,
  tenant_id               text not null,
  workspace_id            text not null references workspaces (id) on delete cascade,
  scope_type              text not null check (scope_type in ('workspace', 'team', 'connection')),
  scope_id                text,
  first_response_seconds  integer check (first_response_seconds is null or first_response_seconds > 0),
  resolution_seconds      integer check (resolution_seconds is null or resolution_seconds > 0),
  updated_by              text,
  updated_at              timestamptz not null default now(),
  check ((scope_type = 'workspace') = (scope_id is null))
);
create unique index if not exists inbox_sla_policies_scope on inbox_sla_policies (workspace_id, scope_type, coalesce(scope_id, ''));

-- Dashboard: consultas por período de ciclos e atendimentos.
create index if not exists inbox_attendance_assignments_workspace_started_idx on inbox_attendance_assignments (workspace_id, started_at);
create index if not exists inbox_attendance_assignments_workspace_ended_idx on inbox_attendance_assignments (workspace_id, ended_at) where ended_at is not null;
create index if not exists inbox_attendances_workspace_status_idx on inbox_attendances (workspace_id, status);
