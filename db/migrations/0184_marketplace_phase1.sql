-- 0182/0183 belong to the concurrent catalog/analytics integration. Recheck numbering on rebase.
create table marketplace_connections (
 id text primary key, tenant_id text not null, workspace_id text not null references workspaces(id) on delete cascade,
 provider text not null check(provider='MERCADO_LIVRE'), external_account_id text not null,
 external_account_name text not null, application_id text not null, site_id text not null default 'MLB',
 user_products boolean not null default false, status text not null default 'CONNECTED'
 check(status in('CONNECTED','DISCONNECTED','REAUTH_REQUIRED','ERROR')),
 credentials_ref text not null, safety_stock integer not null default 0 check(safety_stock between 0 and 1000000000),
 token_expires_at timestamptz, refresh_lease_until timestamptz, refresh_token text,
 connected_at timestamptz, last_sync_at timestamptz, last_error text, updated_at timestamptz not null default now(),
 unique(tenant_id,workspace_id,id), unique(application_id,external_account_id)
);
-- refresh_token above is a lease OWNER token, never an OAuth credential; rename for clarity.
alter table marketplace_connections rename column refresh_token to refresh_owner;
create table marketplace_oauth_states (
 state_hash text primary key, tenant_id text not null, workspace_id text not null references workspaces(id) on delete cascade,
 user_id text not null, verifier_ref text not null, expires_at timestamptz not null
);
create table channel_listings (
 id text primary key, tenant_id text not null, workspace_id text not null,
 connection_id text not null, product_id text not null references products(id) on delete restrict,
 variant_id text references product_variants(id) on delete restrict,
 external_listing_id text, external_product_id text, external_category_id text not null,
 external_url text, external_sku text, status text not null default 'DRAFT',
 sync_status text not null default 'PENDING' check(sync_status in('SYNCED','PENDING','ERROR','DIVERGED','REAUTH_REQUIRED')),
 external_price bigint, external_quantity numeric, last_synced_price bigint, last_synced_quantity numeric,
 snapshot jsonb, draft jsonb, variant_links jsonb not null default '[]'::jsonb,
 last_sync_at timestamptz, last_error text, updated_at timestamptz not null default now(),
 foreign key(tenant_id,workspace_id,connection_id) references marketplace_connections(tenant_id,workspace_id,id) on delete cascade,
 unique(connection_id,external_listing_id)
);
create index channel_listings_product_scope on channel_listings(tenant_id,workspace_id,product_id);
create table marketplace_category_mappings (
 tenant_id text not null, workspace_id text not null, connection_id text not null,
 category_id text not null references product_categories(id) on delete cascade, external_category_id text not null,
 attributes jsonb not null default '[]'::jsonb,
 primary key(tenant_id,workspace_id,connection_id,category_id),
 foreign key(tenant_id,workspace_id,connection_id) references marketplace_connections(tenant_id,workspace_id,id) on delete cascade
);
create table marketplace_jobs (
 id text primary key, tenant_id text not null, workspace_id text not null, connection_id text not null,
 kind text not null check(kind in('PREVIEW','IMPORT','PUBLISH','UPDATE','SYNC','RECONCILE','STATUS')),
 status text not null default 'PENDING' check(status in('PENDING','RUNNING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED','UNKNOWN_RESULT')),
 operation_key text not null, request_hash text not null, payload jsonb not null default '{}'::jsonb,
 progress integer not null default 0, total integer not null default 0, attempts integer not null default 0,
 run_after timestamptz not null default now(), lease_until timestamptz, lease_token text,
 last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,workspace_id,operation_key),
 foreign key(tenant_id,workspace_id,connection_id) references marketplace_connections(tenant_id,workspace_id,id) on delete cascade
);
create index marketplace_jobs_due on marketplace_jobs(run_after) where status in('PENDING','RUNNING');
create table marketplace_job_items (
 job_id text not null references marketplace_jobs(id) on delete cascade, external_id text not null,
 status text not null, result jsonb not null default '{}'::jsonb, primary key(job_id,external_id)
);
create table marketplace_outbox (
 tenant_id text not null, workspace_id text not null, product_id text not null references products(id) on delete cascade,
 revision bigint not null default 1, updated_at timestamptz not null default now(),
 primary key(tenant_id,workspace_id,product_id)
);
create table marketplace_notifications (
 connection_id text not null references marketplace_connections(id) on delete cascade,
 event_id text not null, topic text not null, resource text not null, received_at timestamptz not null default now(),
 primary key(connection_id,event_id)
);
create table marketplace_audit (
 id text primary key, tenant_id text not null, workspace_id text not null,
 actor_id text not null, action text not null, target_id text not null, code text,
 created_at timestamptz not null default now()
);
create index marketplace_audit_scope on marketplace_audit(tenant_id,workspace_id,created_at);
create function enqueue_marketplace_catalog_change() returns trigger language plpgsql as $$
declare pid text;
begin
 if tg_table_name='products' then pid:=new.id; else pid:=new.product_id; end if;
 if exists(select 1 from channel_listings where tenant_id=new.tenant_id and workspace_id=new.workspace_id and product_id=pid) then
  insert into marketplace_outbox(tenant_id,workspace_id,product_id) values(new.tenant_id,new.workspace_id,pid)
  on conflict(tenant_id,workspace_id,product_id) do update set revision=marketplace_outbox.revision+1,updated_at=now();
 end if;
 return new;
end $$;
create trigger marketplace_product_changed after update of price_cents,stock_quantity,reserved_quantity,active,track_stock on products
 for each row execute function enqueue_marketplace_catalog_change();
create trigger marketplace_variant_changed after update of list_price_cents,price_override,stock_quantity,reserved_quantity,active on product_variants
 for each row execute function enqueue_marketplace_catalog_change();
