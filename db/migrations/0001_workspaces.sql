-- Workspace — unidade central de organização (empresa/marca/cliente) sob um Tenant (Valentina,
-- que continua em JSON nesta sprint; por isso tenant_id não tem FK real aqui).
--
-- campaign_ids NÃO é uma coluna aqui de propósito (correção obrigatória da Sprint 03): Campaign
-- continua no armazenamento legado; quando for migrada, a relação nasce do lado da campanha
-- (campaigns.workspace_id), nunca sincronizando um array de ids nesta tabela.
create table workspaces (
  id                   text primary key,
  tenant_id            text not null,
  name                 text not null,
  kind                 text,
  status               text not null,
  created_at           timestamptz not null,
  updated_at           timestamptz not null,
  archived_at          timestamptz,
  -- Ponte opcional/temporária para Clara.clientId — dívida arquitetural documentada
  -- (workspace.model.ts, WorkspaceKnowledgeRef). Nunca lida/escrita por nenhum caso de uso ainda.
  knowledge_client_id  text,
  settings             jsonb not null default '{}'::jsonb,

  constraint workspaces_status_check check (status in ('active', 'inactive', 'archived')),
  -- archived_at só pode existir quando status = 'archived', e é obrigatório quando arquivado.
  constraint workspaces_archived_at_consistency check (
    (status = 'archived' and archived_at is not null) or
    (status <> 'archived' and archived_at is null)
  )
);

-- Consulta principal do produto: "todos os workspaces de um tenant" (listByTenant).
create index workspaces_tenant_id_idx on workspaces (tenant_id);

-- Filtro por status dentro de um tenant (ex.: "workspaces ativos do tenant X") — composto porque
-- a query real sempre carrega tenant_id junto; um índice só em status seria pouco seletivo
-- (poucos valores possíveis) e raramente usado sozinho.
create index workspaces_tenant_id_status_idx on workspaces (tenant_id, status);
