-- Vorix Commerce multicanal: pedidos externos (Mercado Livre, Shopee, TikTok Shop) no MESMO pedido,
-- estoque e central do Site; envios/rastreio; devoluções parciais com reposição só no recebimento;
-- estorno parcial. Somente aditiva: nenhuma coluna existente muda de significado.
-- Rollback: as tabelas novas podem ser removidas; as colunas novas são opcionais (pedidos do Site
-- não as usam) e os checks ampliados aceitam todos os valores anteriores.

-- ------------------------------------------------------------------ marketplaces multi-provider
alter table marketplace_connections drop constraint if exists marketplace_connections_provider_check;
alter table marketplace_connections add constraint marketplace_connections_provider_check check(provider in('MERCADO_LIVRE','SHOPEE','TIKTOK_SHOP'));
alter table marketplace_connections
 add column if not exists settings jsonb not null default '{}'::jsonb,
 add column if not exists metadata jsonb not null default '{}'::jsonb,
 add column if not exists orders_synced_at timestamptz;
alter table marketplace_oauth_states add column if not exists provider text not null default 'MERCADO_LIVRE';
alter table marketplace_jobs drop constraint if exists marketplace_jobs_kind_check;
alter table marketplace_jobs add constraint marketplace_jobs_kind_check check(kind in('PREVIEW','IMPORT','PUBLISH','UPDATE','SYNC','RECONCILE','STATUS','ORDERS','ORDER','CANCEL_ORDER'));

-- ------------------------------------------------------------------ pedidos externos
alter table commerce_orders
 add column if not exists connection_id text,
 add column if not exists external_order_id text,
 add column if not exists external_status text,
 add column if not exists external_updated_at timestamptz,
 add column if not exists external_data jsonb not null default '{}'::jsonb,
 add column if not exists refunded_cents bigint not null default 0 check(refunded_cents>=0),
 add column if not exists shipped_at timestamptz,
 add column if not exists delivered_at timestamptz;
-- Um pedido do marketplace existe uma vez só por conta conectada (webhook/polling repetido).
create unique index if not exists commerce_orders_external_idx on commerce_orders(connection_id,external_order_id) where external_order_id is not null;
create index if not exists commerce_orders_source_idx on commerce_orders(tenant_id,workspace_id,source,created_at desc);
alter table commerce_orders drop constraint if exists commerce_orders_stock_state_check;
-- CONFLICT: venda externa sem saldo central (registrada, nunca descartada). EXTERNAL: estoque do próprio marketplace (Full/FBS).
alter table commerce_orders add constraint commerce_orders_stock_state_check check(stock_state in ('NONE','RESERVED','RELEASED','SOLD','RETURNED','CONFLICT','EXTERNAL'));
alter table commerce_orders drop constraint if exists commerce_orders_payment_status_check;
alter table commerce_orders add constraint commerce_orders_payment_status_check check(payment_status in ('PENDING','APPROVED','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED'));
-- Item de anúncio ainda não vinculado a um produto do Vorix: registrado sem baixa de estoque.
alter table commerce_order_items alter column product_id drop not null;
alter table commerce_order_items
 add column if not exists external_item_id text,
 add column if not exists external_variation_id text;
alter table commerce_order_items drop constraint if exists commerce_order_items_quantity_check;
alter table commerce_order_items add constraint commerce_order_items_quantity_check check(quantity between 1 and 100000);
alter table commerce_payments add column if not exists refunded_cents bigint not null default 0 check(refunded_cents>=0);

-- Contato do comprador do marketplace (somente quando a conexão permitir).
alter table contact_identities drop constraint if exists contact_identities_channel_check;
alter table contact_identities add constraint contact_identities_channel_check check (channel in ('whatsapp','instagram','facebook','tiktok','mercado_livre','shopee','tiktok_shop'));

-- ------------------------------------------------------------------ envios
create table if not exists commerce_shipments (
 id text primary key, tenant_id text not null, workspace_id text not null,
 order_id text not null references commerce_orders(id) on delete cascade,
 provider text not null, external_shipment_id text,
 status text not null check(status in ('PENDING','READY_TO_SHIP','SHIPPED','DELIVERED','NOT_DELIVERED','CANCELLED')),
 external_status text, substatus text, logistic_type text, carrier text, tracking_number text, tracking_url text,
 label_available boolean not null default false, fulfilled_by_marketplace boolean not null default false,
 shipped_at timestamptz, delivered_at timestamptz, estimated_delivery_at timestamptz,
 events jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists commerce_shipments_external_idx on commerce_shipments(order_id,external_shipment_id) where external_shipment_id is not null;
create unique index if not exists commerce_shipments_own_idx on commerce_shipments(order_id) where external_shipment_id is null;
create index if not exists commerce_shipments_scope_idx on commerce_shipments(tenant_id,workspace_id,updated_at desc);

-- ------------------------------------------------------------------ devoluções
create table if not exists commerce_returns (
 id text primary key, tenant_id text not null, workspace_id text not null,
 order_id text not null references commerce_orders(id) on delete cascade,
 source text not null, external_return_id text, request_key text,
 status text not null default 'REQUESTED' check(status in ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','COMPLETED','REJECTED','CANCELLED')),
 external_status text, reason text,
 refund_cents bigint not null default 0 check(refund_cents>=0),
 refund_status text not null default 'NONE' check(refund_status in ('NONE','PROCESSING','REFUNDED','FAILED','NOT_SUPPORTED','MARKETPLACE')),
 refund_provider_id text, created_by text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 approved_at timestamptz, received_at timestamptz, completed_at timestamptz, refunded_at timestamptz
);
create unique index if not exists commerce_returns_request_idx on commerce_returns(order_id,request_key) where request_key is not null;
create unique index if not exists commerce_returns_external_idx on commerce_returns(order_id,external_return_id) where external_return_id is not null;
create index if not exists commerce_returns_scope_idx on commerce_returns(tenant_id,workspace_id,created_at desc);
create table if not exists commerce_return_items (
 id text primary key, return_id text not null references commerce_returns(id) on delete cascade,
 order_item_id text not null references commerce_order_items(id) on delete cascade,
 quantity integer not null check(quantity>0),
 received_quantity integer not null default 0 check(received_quantity>=0 and received_quantity<=quantity),
 restocked_quantity integer not null default 0 check(restocked_quantity>=0 and restocked_quantity<=received_quantity),
 reason text, unique(return_id,order_item_id)
);
