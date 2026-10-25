-- 0173 — Perfis, direitos de acesso e escopo. Ver src/domain/identity/access-control.ts.
-- Perfil base continua sendo `tenant_members.role` (owner = Administrador, admin = Gerente,
-- editor = Atendente, viewer = Visualizador). Exceções individuais ficam na própria linha do
-- membro; o escopo de equipe reaproveita `team_memberships.role` (owner/admin na equipe = gerente).

alter table tenant_members add column if not exists permission_grants text[] not null default '{}';
alter table tenant_members add column if not exists permission_revokes text[] not null default '{}';
alter table tenant_members add column if not exists status text not null default 'active';
alter table tenant_members add column if not exists disabled_at timestamptz;
alter table tenant_members add column if not exists is_account_owner boolean not null default false;
alter table tenant_members drop constraint if exists tenant_members_status_check;
alter table tenant_members add constraint tenant_members_status_check check (status in ('active', 'disabled'));

-- Administrador principal: o owner mais antigo de cada empresa (quem criou a conta). Um por empresa.
update tenant_members m set is_account_owner = true
from (
  select distinct on (tenant_id) id from tenant_members where role = 'owner' order by tenant_id, created_at, id
) first_owner
where m.id = first_owner.id
  and not exists (select 1 from tenant_members x where x.tenant_id = m.tenant_id and x.is_account_owner);
create unique index if not exists tenant_members_one_account_owner on tenant_members (tenant_id) where is_account_owner;

-- Compatibilidade: o perfil "Gestor" (admin) tinha escopo global e gerenciava usuários/equipes.
-- O novo preset de Gerente é por equipe e sem gestão de acesso; para nenhum gestor existente perder
-- acesso, o que ele tinha vira exceção concedida (o Administrador pode remover depois).
update tenant_members
set permission_grants = (
  select array_agg(distinct permission order by permission)
  from unnest(permission_grants || array[
    'automation:manage', 'deal:view_all', 'goal:manage', 'goal:read_all', 'inbox:delete_connections',
    'inbox:manage_connections', 'inbox:manage_service', 'inbox:view_all', 'sales_report:read_all',
    'team:manage', 'tenant_member:manage', 'tenant_member:manage_permissions'
  ]) as permission
)
where role = 'admin';

-- Auditoria estruturada de acesso (nunca só texto). Sem FK: a trilha sobrevive à exclusão do usuário.
create table if not exists access_audit_log (
  id              text primary key,
  tenant_id       text not null,
  actor_user_id   text not null,
  target_user_id  text,
  team_id         text,
  event_type      text not null check (event_type in (
    'member_created', 'member_removed', 'member_disabled', 'member_enabled',
    'role_changed', 'permission_granted', 'permission_revoked', 'permission_reset',
    'team_member_added', 'team_member_removed', 'team_manager_granted', 'team_manager_revoked',
    'invite_created'
  )),
  previous_value  jsonb,
  new_value       jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists access_audit_log_tenant_idx on access_audit_log (tenant_id, created_at desc);
create index if not exists access_audit_log_target_idx on access_audit_log (tenant_id, target_user_id, created_at desc);

-- Kanban de Oportunidades por equipe: funil sem equipe = da empresa toda (comportamento atual).
alter table pipelines add column if not exists team_id text references teams (id) on delete set null;
create index if not exists pipelines_team_idx on pipelines (workspace_id, team_id);
