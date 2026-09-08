-- 0089 — CRM/Comercial, Fase 1 (Fundação Comercial): Equipes. Escopo novo de RBAC, mais fino que
-- TenantMembership (que é por tenant inteiro) — um usuário pode pertencer a várias equipes dentro
-- do mesmo workspace, cada uma com seu próprio papel (reaproveita o MESMO vocabulário de
-- TenantRole, nunca um segundo vocabulário de papel).

create table if not exists teams (
  id            text primary key,
  tenant_id     text not null,
  workspace_id  text not null references workspaces (id) on delete cascade,
  name          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists teams_tenant_workspace_idx on teams (tenant_id, workspace_id);

create table if not exists team_memberships (
  id          text primary key,
  team_id     text not null references teams (id) on delete cascade,
  user_id     text not null,
  role        text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at  timestamptz not null default now(),

  unique (team_id, user_id)
);

create index if not exists team_memberships_team_idx on team_memberships (team_id);
create index if not exists team_memberships_user_idx on team_memberships (user_id);
