create table if not exists tenant_sites (
 id text primary key, tenant_id text not null, workspace_id text not null, slug text not null unique,
 draft jsonb not null, published jsonb, revision integer not null default 1,
 published_at timestamptz, updated_at timestamptz not null default now(),
 unique(tenant_id,workspace_id), unique(tenant_id,id),
 foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id) on delete cascade
);
create table if not exists site_domains (
 id text primary key, site_id text not null, tenant_id text not null,
 hostname text not null unique, challenge text not null, verified_at timestamptz,
 expires_at timestamptz not null, foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);
create table if not exists site_publication_events (
 id text primary key, site_id text not null, tenant_id text not null, revision integer not null,
 actor_user_id text not null, event_type text not null check(event_type in ('published','unpublished')),
 created_at timestamptz not null default now(), foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);
create table if not exists site_inquiries (
 id text primary key, site_id text not null, tenant_id text not null, workspace_id text not null,
 contact_id text references contacts(id) on delete set null, product_id text, variant_id text,
 message text not null, request_key text not null, created_at timestamptz not null default now(),
 unique(site_id,request_key), foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade,
 foreign key(tenant_id,workspace_id,product_id) references products(tenant_id,workspace_id,id)
);
