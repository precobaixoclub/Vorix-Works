-- Conversation — Sprint 06. O "fio" da conversa, com o estado do turno mais recente (`state`).
-- tenant_id/workspace_id são referências soltas (mesmo padrão de workspaces.tenant_id) —
-- workspace_id tem FK real porque Workspace já vive em Postgres desde a Sprint 03.
create table conversations (
  id            text primary key,
  tenant_id     text not null,
  workspace_id  text not null references workspaces (id) on delete cascade,
  status        text not null,
  state         text not null,
  title         text,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,

  constraint conversations_status_check check (status in ('active', 'archived')),
  constraint conversations_state_check check (state in ('idle', 'processing', 'awaiting_context', 'waiting_action', 'resolved'))
);

-- Consulta principal: "conversas de um workspace, isoladas por tenant" (listByWorkspace).
create index conversations_tenant_id_workspace_id_idx on conversations (tenant_id, workspace_id);
