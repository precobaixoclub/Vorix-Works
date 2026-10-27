-- Vorix Commerce, Fase 2: pedidos, checkout, pagamento e frete. Somente aditiva.
-- Order é uma venda transacional própria (não é Opportunity). Itens guardam snapshot completo.

create table if not exists commerce_order_counters (
 workspace_id text primary key, last_number integer not null default 0
);

create table if not exists commerce_orders (
 id text primary key, tenant_id text not null, workspace_id text not null, site_id text,
 number integer not null,
 public_token_hash text not null unique,
 source text not null default 'SITE' check(source in ('SITE','MERCADO_LIVRE','SHOPEE','TIKTOK_SHOP','MANUAL')),
 status text not null check(status in ('PENDING','AWAITING_PAYMENT','PAID','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
 payment_status text not null default 'PENDING' check(payment_status in ('PENDING','APPROVED','FAILED','CANCELLED','REFUNDED')),
 shipping_status text not null default 'PENDING' check(shipping_status in ('NOT_REQUIRED','PENDING','READY_FOR_PICKUP','SHIPPED','DELIVERED','CANCELLED')),
 stock_state text not null default 'NONE' check(stock_state in ('NONE','RESERVED','RELEASED','SOLD','RETURNED')),
 contact_id text, customer jsonb not null, shipping_address jsonb, delivery jsonb not null,
 subtotal_cents bigint not null check(subtotal_cents>=0), discount_cents bigint not null default 0 check(discount_cents>=0),
 shipping_cents bigint not null default 0 check(shipping_cents>=0), total_cents bigint not null check(total_cents>=0), currency text not null default 'BRL',
 crm_deal_id text, sales_intent_id text, cart_id text, request_key text, anonymous_session_id text, utm jsonb not null default '{}'::jsonb,
 reservation_expires_at timestamptz, cancel_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), paid_at timestamptz, cancelled_at timestamptz,
 unique(workspace_id,number),
 foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id) on delete cascade
);
create unique index if not exists commerce_orders_request_key_idx on commerce_orders(site_id,request_key) where request_key is not null;
create index if not exists commerce_orders_workspace_idx on commerce_orders(tenant_id,workspace_id,created_at desc);
create index if not exists commerce_orders_expiring_idx on commerce_orders(reservation_expires_at) where status='AWAITING_PAYMENT';

create table if not exists commerce_order_items (
 id text primary key, order_id text not null references commerce_orders(id) on delete cascade,
 position integer not null, product_id text not null, variant_id text, sku text, name text not null, variant_label text, image_url text,
 quantity integer not null check(quantity between 1 and 999), unit_price_cents bigint not null check(unit_price_cents>=0), total_cents bigint not null check(total_cents>=0),
 track_stock boolean not null default false, specifications jsonb not null default '[]'::jsonb
);
create index if not exists commerce_order_items_order_idx on commerce_order_items(order_id);

-- Histórico estruturado (status, pagamento, estoque, envio). Nunca texto solto.
create table if not exists commerce_order_events (
 id text primary key, order_id text not null references commerce_orders(id) on delete cascade,
 type text not null, from_status text, to_status text, actor_type text not null default 'system', actor_id text,
 data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists commerce_order_events_order_idx on commerce_order_events(order_id,created_at);

create table if not exists commerce_payments (
 id text primary key, tenant_id text not null, workspace_id text not null, order_id text not null references commerce_orders(id) on delete cascade,
 provider text not null, method text not null check(method in ('PIX','CARD','SANDBOX')),
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','FAILED','CANCELLED','REFUNDED')),
 amount_cents bigint not null check(amount_cents>=0), currency text not null default 'BRL',
 provider_payment_id text, instructions jsonb not null default '{}'::jsonb, failure_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), approved_at timestamptz, refunded_at timestamptz
);
create unique index if not exists commerce_payments_provider_idx on commerce_payments(provider,provider_payment_id) where provider_payment_id is not null;
create index if not exists commerce_payments_order_idx on commerce_payments(order_id);

-- Webhook duplicado nunca reprocessa: chave única por evento do provedor.
create table if not exists commerce_webhook_events (
 id text primary key, provider text not null, event_key text not null, order_id text, payment_id text,
 received_at timestamptz not null default now(), unique(provider,event_key)
);

-- Medidas para frete: produto guarda em details.shipping; a variação pode sobrescrever.
alter table product_variants add column if not exists weight_grams integer;
alter table product_variants add column if not exists height_cm numeric(8,2);
alter table product_variants add column if not exists width_cm numeric(8,2);
alter table product_variants add column if not exists length_cm numeric(8,2);

alter table sales_intents add column if not exists order_id text;
alter table site_carts drop constraint if exists site_carts_status_check;
alter table site_carts add constraint site_carts_status_check check(status in ('ACTIVE','CHECKED_OUT','ORDERED','ABANDONED'));

alter table site_events drop constraint if exists site_events_type_check;
alter table site_events add constraint site_events_type_check check(type in ('SITE_VIEW','PRODUCT_VIEW','PRODUCT_WHATSAPP_CLICK','ADD_TO_CART','REMOVE_FROM_CART','CART_WHATSAPP_START','CONTACT_FORM_SUBMITTED','SALES_INTENT_CREATED','SALES_INTENT_CONVERTED','CHECKOUT_STARTED','SHIPPING_QUOTED','PAYMENT_STARTED','ORDER_CREATED','PAYMENT_APPROVED','ORDER_PAID','ORDER_CANCELLED','ORDER_COMPLETED'));
alter table site_events add column if not exists order_id text;

-- Oportunidade ganha criada a partir de pedido pago (opcional) não baixa estoque de novo.
create or replace function vorix_deal_variant_inventory() returns trigger language plpgsql as $$
declare item record; variant record; net numeric; amount numeric;
begin
 if new.status = old.status then return new; end if;
 -- Venda já liquidada por um pedido pago da loja online: o pedido é dono do estoque (sem segunda baixa nem devolução).
 if coalesce(new.custom_fields->>'commerceOrderId','') <> '' then return new; end if;
 if new.status = 'won' then
  for item in select di.product_id,di.variant_id,sum(di.quantity) as quantity
    from deal_items di join products p on p.id=di.product_id and p.tenant_id=new.tenant_id and p.workspace_id=new.workspace_id
    where di.deal_id=new.id and di.tenant_id=new.tenant_id and di.workspace_id=new.workspace_id and di.variant_id is not null and p.track_stock and jsonb_array_length(coalesce(p.details->'options','[]'::jsonb))>0
    group by di.product_id,di.variant_id order by di.variant_id
  loop
   select * into variant from product_variants where id=item.variant_id and product_id=item.product_id and tenant_id=new.tenant_id and workspace_id=new.workspace_id for update;
   if not found or not variant.active then raise exception 'INVENTORY_VARIANT_UNAVAILABLE'; end if;
   select coalesce(sum(delta),0) into net from product_stock_movements where deal_id=new.id and variant_id=item.variant_id;
   amount := greatest(0,item.quantity+net);
   if variant.stock_quantity-variant.reserved_quantity < amount then raise exception 'INVENTORY_INSUFFICIENT: estoque insuficiente da variante'; end if;
   if amount>0 then
    update product_variants set stock_quantity=stock_quantity-amount,updated_at=now() where id=variant.id;
    insert into product_stock_movements(id,tenant_id,workspace_id,product_id,variant_id,delta,quantity_after,reason,deal_id,movement_type)
     values('stock-'||md5(random()::text||clock_timestamp()::text),new.tenant_id,new.workspace_id,item.product_id,variant.id,-amount,variant.stock_quantity-amount,'deal_won',new.id,'SALE');
   end if;
  end loop;
 elsif old.status = 'won' then
  for item in select product_id,variant_id,sum(delta) as delta from product_stock_movements
    where deal_id=new.id and tenant_id=new.tenant_id and workspace_id=new.workspace_id and variant_id is not null
    group by product_id,variant_id having sum(delta)<0 order by variant_id
  loop
   update product_variants set stock_quantity=stock_quantity-item.delta,updated_at=now() where id=item.variant_id returning * into variant;
   insert into product_stock_movements(id,tenant_id,workspace_id,product_id,variant_id,delta,quantity_after,reason,deal_id,movement_type)
    values('stock-'||md5(random()::text||clock_timestamp()::text),new.tenant_id,new.workspace_id,item.product_id,item.variant_id,-item.delta,variant.stock_quantity,'deal_reverted',new.id,'RETURN');
  end loop;
 end if;
 return new;
end $$;
