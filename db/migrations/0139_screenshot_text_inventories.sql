-- 0139 — SCREENSHOT_TEXT_INVENTORY: cache do inventário de texto de um screenshot real verificado.
-- Aditiva (tabela nova; nada existente muda). Uma linha por tenant + workspace + hash dos bytes do
-- asset + versão do inventário: o mesmo arquivo em outro workspace nunca reaproveita a leitura
-- (isolamento multi-tenant), e um screenshot alterado tem outro hash. Só proveniência de texto para
-- o Quality Gate — nunca fonte de fato comercial (preço/desconto/claim lidos aqui não viram fatos).

create table if not exists screenshot_text_inventories (
  id                text primary key,
  tenant_id         text not null,
  workspace_id      text not null references workspaces (id) on delete cascade,
  asset_sha256      text not null,
  inventory_version integer not null,
  inventory_source  text not null,
  status            text not null,
  texts             jsonb not null,
  provider          text,
  model             text,
  first_asset_url   text not null,
  scanned_at        timestamptz not null,
  created_at        timestamptz not null default now()
);

create unique index if not exists screenshot_text_inventories_key_uq
  on screenshot_text_inventories (tenant_id, workspace_id, asset_sha256, inventory_version);
