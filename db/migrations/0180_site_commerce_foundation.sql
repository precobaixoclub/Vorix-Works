-- Vorix Commerce, Fase 1: fundação comercial do Site (venda assistida + carrinho para WhatsApp).
-- Somente aditiva. Site sem linha em site_commerce_settings mantém o comportamento anterior
-- (resolvido no código como modo WhatsApp quando há número, vitrine quando não há).

create table if not exists site_commerce_settings (
 site_id text primary key, tenant_id text not null, workspace_id text not null,
 settings jsonb not null, updated_by_user_id text, updated_at timestamptz not null default now(),
 foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);

-- Intenção comercial: o visitante demonstrou interesse. Não é venda nem oportunidade.
create table if not exists sales_intents (
 id text primary key, tenant_id text not null, workspace_id text not null, site_id text not null,
 reference text not null unique,
 type text not null check(type in ('PRODUCT_WHATSAPP','CART_WHATSAPP','CONTACT_FORM','CHECKOUT','MARKETPLACE','OTHER')),
 status text not null default 'OPEN' check(status in ('OPEN','CONVERTING','CONVERTED','EXPIRED')),
 source text not null default 'SITE',
 product_id text, variant_id text, quantity numeric(14,3),
 snapshot jsonb not null default '{}'::jsonb,
 page_url text, utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
 anonymous_session_id text, request_key text,
 click_count integer not null default 0, last_clicked_at timestamptz,
 claimed_at timestamptz, conversion_error text,
 contact_id text, conversation_id text, attendance_id text, deal_id text,
 created_at timestamptz not null default now(), expires_at timestamptz not null, converted_at timestamptz,
 foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);
create unique index if not exists sales_intents_request_key_idx on sales_intents(site_id,request_key) where request_key is not null;
create index if not exists sales_intents_workspace_idx on sales_intents(tenant_id,workspace_id,created_at desc);
create index if not exists sales_intents_session_idx on sales_intents(site_id,anonymous_session_id) where anonymous_session_id is not null;

-- Carrinho é intenção, não pedido (Order chega na Fase 2). Token anônimo guardado só como hash.
create table if not exists site_carts (
 id text primary key, tenant_id text not null, workspace_id text not null, site_id text not null,
 token_hash text not null unique, anonymous_session_id text,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','CHECKED_OUT','ABANDONED')),
 customer_id text, sales_intent_id text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz not null,
 foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);
create table if not exists site_cart_items (
 id text primary key, cart_id text not null references site_carts(id) on delete cascade,
 product_id text not null, variant_id text, quantity integer not null check(quantity between 1 and 999),
 product_snapshot jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists site_cart_items_line_idx on site_cart_items(cart_id,product_id,coalesce(variant_id,''));

-- Eventos estruturados do Site (base de analytics; não usa product_events, que é telemetria do Vorix).
create table if not exists site_events (
 id text primary key, tenant_id text not null, workspace_id text not null, site_id text not null,
 type text not null check(type in ('SITE_VIEW','PRODUCT_VIEW','PRODUCT_WHATSAPP_CLICK','ADD_TO_CART','REMOVE_FROM_CART','CART_WHATSAPP_START','CONTACT_FORM_SUBMITTED','SALES_INTENT_CREATED','SALES_INTENT_CONVERTED')),
 anonymous_session_id text, contact_id text, product_id text, variant_id text, sales_intent_id text, cart_id text,
 page_url text, utm jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);
create index if not exists site_events_site_idx on site_events(site_id,created_at desc);
create index if not exists site_events_session_idx on site_events(site_id,anonymous_session_id) where anonymous_session_id is not null;

alter table site_inquiries add column if not exists sales_intent_id text;
alter table site_inquiries add column if not exists deal_id text;
