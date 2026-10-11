-- 0140 — Objetos EXPLICITAMENTE públicos do object storage.
-- Aditiva (tabela nova). Desde esta versão `/uploads/<key>` é PRIVADO por padrão: só serve com URL
-- assinada curta (escopo de uma chave) OU se a chave estiver aqui, com o motivo persistido.
-- "Estar em /uploads" nunca mais significa "público". Sem linhas = nenhum arquivo público.

create table if not exists public_objects (
  object_key    text primary key,
  tenant_id     text not null,
  workspace_id  text,
  reason        text not null,
  published_by  text,
  created_at    timestamptz not null default now()
);

create index if not exists public_objects_tenant_idx on public_objects (tenant_id);
