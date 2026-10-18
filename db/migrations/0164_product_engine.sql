-- Evolução aditiva de Product e ProductVariant; IDs e snapshots anteriores são preservados.
create unique index if not exists products_scope_identity on products (tenant_id, workspace_id, id);
create unique index if not exists product_variants_scope_identity on product_variants (tenant_id, workspace_id, product_id, id);
create unique index if not exists workspaces_tenant_identity on workspaces (tenant_id, id);

create table if not exists product_categories (
 id text primary key, tenant_id text not null, workspace_id text not null, name text not null, slug text not null,
 parent_id text, active boolean not null default true, site_visible boolean not null default true,
 position integer not null default 0, image_url text,
 unique(tenant_id, workspace_id, id), unique(tenant_id, workspace_id, slug),
 foreign key(tenant_id, workspace_id) references workspaces(tenant_id, id) on delete cascade,
 foreign key(tenant_id, workspace_id, parent_id) references product_categories(tenant_id, workspace_id, id)
);
create table if not exists product_brands (
 id text primary key, tenant_id text not null, workspace_id text not null, name text not null, slug text not null,
 active boolean not null default true, logo_url text,
 unique(tenant_id, workspace_id, id), unique(tenant_id, workspace_id, slug),
 foreign key(tenant_id, workspace_id) references workspaces(tenant_id, id) on delete cascade
);
create table if not exists product_attribute_definitions (
 id text primary key, tenant_id text not null, workspace_id text not null, category_id text,
 key text not null, label text not null, kind text not null check(kind in ('text','number','boolean','select')),
 choices jsonb not null default '[]', required boolean not null default false, unit text, active boolean not null default true,
 unique(tenant_id, workspace_id, key),
 foreign key(tenant_id, workspace_id) references workspaces(tenant_id, id) on delete cascade,
 foreign key(tenant_id, workspace_id, category_id) references product_categories(tenant_id, workspace_id, id)
);
alter table products add column if not exists details jsonb not null default '{"type":"GENERAL","attributes":{},"options":[],"siteVisible":false,"catalogVisible":true,"canPurchaseOnline":false,"seo":{},"media":[]}',
 add column if not exists category_id text, add column if not exists brand_id text,
 add column if not exists reserved_quantity numeric(14,3) not null default 0;
do $$ begin
 alter table products add constraint products_category_scope_fk foreign key(tenant_id,workspace_id,category_id) references product_categories(tenant_id,workspace_id,id);
exception when duplicate_object then null; end $$;
do $$ begin
 alter table products add constraint products_brand_scope_fk foreign key(tenant_id,workspace_id,brand_id) references product_brands(tenant_id,workspace_id,id);
exception when duplicate_object then null; end $$;
create index if not exists products_type_idx on products(tenant_id,workspace_id,(details->>'type'));
create index if not exists products_vehicle_idx on products(tenant_id,workspace_id,(details->'vehicle'->>'make'),(details->'vehicle'->>'model'),(details->'vehicle'->>'version'));
create unique index if not exists products_public_slug_idx on products(tenant_id,workspace_id,(details->>'slug')) where details->>'slug' is not null;
alter table product_variants add column if not exists option_values jsonb not null default '{}',
 add column if not exists price_override boolean not null default true,
 add column if not exists stock_quantity numeric(14,3) not null default 0,
 add column if not exists reserved_quantity numeric(14,3) not null default 0, add column if not exists image_url text;
create unique index if not exists product_variants_combination_idx on product_variants(product_id,option_values) where option_values <> '{}'::jsonb;
do $$ begin
 alter table product_variants add constraint product_variant_stock_balance check(stock_quantity >= 0 and reserved_quantity >= 0 and stock_quantity >= reserved_quantity);
exception when duplicate_object then null; end $$;
do $$ begin
 alter table product_variants add constraint product_variants_parent_scope_fk foreign key(tenant_id,workspace_id,product_id) references products(tenant_id,workspace_id,id);
exception when duplicate_object then null; end $$;
alter table product_stock_movements add column if not exists variant_id text references product_variants(id),
 add column if not exists movement_type text not null default 'ADJUSTMENT',
 add column if not exists reserved_delta numeric(14,3) not null default 0,
 add column if not exists operation_key text;
create unique index if not exists stock_operation_key_idx on product_stock_movements(tenant_id,workspace_id,operation_key) where operation_key is not null;
alter table deal_items add column if not exists product_context_snapshot jsonb not null default '{}';
alter table product_stock_movements add column if not exists reserved_after numeric(14,3) not null default 0,
 add column if not exists request_fingerprint text;

-- O fechamento da oportunidade e a baixa de TODAS as variantes são uma única transação.
-- Locks em ordem fixa impedem overselling/deadlock; reabertura devolve o saldo efetivamente baixado.
create or replace function vorix_deal_variant_inventory() returns trigger language plpgsql as $$
declare item record; variant record; net numeric; amount numeric;
begin
 if new.status = old.status then return new; end if;
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
drop trigger if exists vorix_deal_variant_inventory_trigger on deals;
create trigger vorix_deal_variant_inventory_trigger after update of status on deals for each row execute function vorix_deal_variant_inventory();
