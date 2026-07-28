-- Membros de um Workspace. user_id referencia um futuro User (ainda inexistente — Sprint 04);
-- mantido como texto opaco, sem FK, pelo mesmo motivo que tenant_id não tem FK.
create table workspace_members (
  workspace_id  text not null references workspaces (id) on delete cascade,
  user_id       text not null,
  role          text not null,
  added_at      timestamptz not null,

  primary key (workspace_id, user_id),
  constraint workspace_members_role_check check (role in ('owner', 'admin', 'editor', 'viewer'))
);

-- Consulta futura (Sprint 04+): "em quais workspaces este usuário está?" — não coberta pela PK,
-- que é otimizada para o sentido contrário (workspace -> membros).
create index workspace_members_user_id_idx on workspace_members (user_id);
