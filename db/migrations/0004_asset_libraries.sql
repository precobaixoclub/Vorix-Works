-- Uma Asset Library por Workspace (1:1) — contêiner; os ativos em si vivem em `assets`.
create table asset_libraries (
  id            text primary key,
  workspace_id  text not null references workspaces (id) on delete cascade,
  created_at    timestamptz not null,
  updated_at    timestamptz not null
);

-- Garante a regra 1:1 (mesma regra já aplicada em InMemoryAssetLibraryRepository via
-- ASSET_LIBRARY_ALREADY_EXISTS) e serve como índice de busca por workspace.
create unique index asset_libraries_workspace_id_uq on asset_libraries (workspace_id);
