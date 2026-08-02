-- Relação User <-> Tenant, carregando o papel (RBAC). tenant_id é referência solta (sem FK) pelo
-- mesmo motivo de workspaces.tenant_id (Sprint 03): Tenant continua em JSON (Valentina), fora de
-- escopo para migrar aqui.
create table tenant_members (
  id          text primary key,
  user_id     text not null references users (id) on delete cascade,
  tenant_id   text not null,
  role        text not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,

  constraint tenant_members_role_check check (role in ('owner', 'admin', 'editor', 'viewer'))
);

-- Um usuário tem no máximo uma associação por tenant.
create unique index tenant_members_user_tenant_uq on tenant_members (user_id, tenant_id);

-- Consulta do Workspace/Tenant Switcher (Fase 6): "a quais tenants este usuário pertence".
create index tenant_members_user_id_idx on tenant_members (user_id);
