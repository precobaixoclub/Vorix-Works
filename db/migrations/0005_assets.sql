-- Registro de um ativo (metadados apenas — upload real é fora de escopo desta sprint).
-- storage_ref nunca contém segredo: só referência durável (provider/bucket/objectKey/metadata
-- técnica não sensível) — correção obrigatória da Sprint 03 (ver AssetStorageRef).
create table assets (
  id            text primary key,
  library_id    text not null references asset_libraries (id) on delete cascade,
  kind          text not null,
  name          text not null,
  status        text not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  archived_at   timestamptz,
  tags          text[] not null default '{}',
  storage_ref   jsonb,

  constraint assets_kind_check check (kind in (
    'logo', 'photo', 'video', 'product', 'mockup', 'visual_identity',
    'font', 'brand_book', 'reference', 'document'
  )),
  constraint assets_status_check check (status in ('active', 'archived')),
  constraint assets_archived_at_consistency check (
    (status = 'archived' and archived_at is not null) or
    (status <> 'archived' and archived_at is null)
  )
);

-- Consulta principal: listAssets(libraryId, {kind}) — composto cobre tanto "todos os ativos da
-- library" quanto "ativos de um tipo específico" sem precisar de dois índices separados.
create index assets_library_id_kind_idx on assets (library_id, kind);

-- Filtro por status (ex.: esconder ativos arquivados por padrão) dentro de uma library.
create index assets_library_id_status_idx on assets (library_id, status);
