-- 0059 — Brand Visual Profile (Rodada 2, Fatia 2, Prioridade 5): linguagem visual persistente por
-- workspace (cores, tipografia, forma, personalidade, skins de componente, tratamento de imagem,
-- posicionamento de logo) — não regenerada a cada publicação. Investigação prévia confirmou que
-- nenhuma tabela Postgres hoje persiste algo assim por workspace; `profile` fica em jsonb (mesmo
-- padrão já usado por `workspaces.settings`) porque a estrutura é rica/aninhada, não um punhado de
-- colunas escalares. 1 linha por workspace (mesma regra 1:1 de `asset_libraries`).

create table brand_visual_profiles (
  id            text primary key,
  workspace_id  text not null references workspaces (id) on delete cascade,
  profile       jsonb not null,
  source        text not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null
);

create unique index brand_visual_profiles_workspace_id_uq on brand_visual_profiles (workspace_id);
