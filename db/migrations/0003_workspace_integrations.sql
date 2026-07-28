-- Integrações de rede social do Workspace. Identificador próprio (não composto) porque um
-- Workspace poderá ter múltiplas contas do mesmo canal (correção obrigatória da Sprint 03).
-- Sem OAuth/conexão real nesta sprint — nenhum caso de uso escreve nesta tabela ainda.
create table workspace_integrations (
  id                   text primary key,
  workspace_id         text not null references workspaces (id) on delete cascade,
  channel              text not null,
  external_account_id  text,
  display_name         text,
  status               text not null,
  connected_at         timestamptz,
  created_at           timestamptz not null,
  updated_at           timestamptz not null,

  constraint workspace_integrations_status_check check (status in ('connected', 'disconnected', 'pending'))
);

-- Impede duas linhas para a mesma conta externa do mesmo canal no mesmo workspace. NULLs em
-- external_account_id (conta ainda não vinculada) não colidem entre si em Postgres — aceitável,
-- pois hoje nenhuma linha é criada com conta real (sem OAuth).
create unique index workspace_integrations_workspace_channel_account_uq
  on workspace_integrations (workspace_id, channel, external_account_id);

-- Consulta principal: "integrações de um workspace, filtradas por canal" (reconstrução do
-- agregado Workspace e futura tela de conexões).
create index workspace_integrations_workspace_id_channel_idx on workspace_integrations (workspace_id, channel);
