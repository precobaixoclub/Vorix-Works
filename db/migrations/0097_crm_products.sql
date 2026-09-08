-- 0097 — CRM/Comercial, Fase 3: Catálogo simples de produtos/serviços. Deliberadamente SEM
-- estoque (fora de escopo — auditoria, "o que não construir": sem ERP/estoque/financeiro completo).

create table if not exists products (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  name         text not null,
  description  text,
  price_cents  bigint not null default 0,
  currency     text not null default 'BRL',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists products_tenant_workspace_idx on products (tenant_id, workspace_id);
