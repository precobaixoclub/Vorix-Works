-- Sessão de conversa dentro de um Workspace. Sem IA/LLM nesta sprint — só a estrutura persistível.
create table chat_sessions (
  id               text primary key,
  workspace_id     text not null references workspaces (id) on delete cascade,
  status           text not null,
  created_at       timestamptz not null,
  updated_at       timestamptz not null,
  title            text,
  context_summary  text,

  constraint chat_sessions_status_check check (status in ('active', 'archived'))
);

-- Consulta principal: listSessionsByWorkspace(workspaceId).
create index chat_sessions_workspace_id_idx on chat_sessions (workspace_id);
