-- 0159 — Controle de estoque por produto: quantidade atual e ponto de reposição (alerta de compra).
-- Opcional por produto (`track_stock`): serviços e itens sem estoque continuam como antes. A baixa
-- automática acontece no ganho da oportunidade e é devolvida se ela for reaberta/perdida.

alter table products
  add column if not exists track_stock boolean not null default false,
  add column if not exists stock_quantity numeric(14, 3) not null default 0,
  add column if not exists stock_alert_threshold numeric(14, 3);

create table if not exists product_stock_movements (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  product_id text not null references products(id) on delete cascade,
  delta numeric(14, 3) not null,
  quantity_after numeric(14, 3) not null,
  reason text not null check (reason in ('manual', 'deal_won', 'deal_reverted')),
  deal_id text,
  user_id text,
  created_at timestamptz not null default now()
);
create index if not exists product_stock_movements_product_idx on product_stock_movements (product_id, created_at desc);
