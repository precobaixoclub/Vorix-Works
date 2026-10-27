-- Parallel to Commerce 0181. No existing migration or Commerce entity is changed.
-- Durable previews and per-product checkpoints are needed for crash-safe background imports.
create table catalog_bulk_jobs (
 id text primary key, tenant_id text not null, workspace_id text not null, user_id text not null,
 operation_key text not null, fingerprint text not null, status text not null,
 headers jsonb not null, source jsonb not null, mapping jsonb not null default '{}', options jsonb not null default '{}',
 access jsonb not null, summary jsonb not null default '{}', failure text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,workspace_id,user_id,operation_key), unique(tenant_id,workspace_id,id),
 foreign key(tenant_id,workspace_id) references workspaces(tenant_id,id) on delete cascade,
 check(status in ('MAPPING','PENDING_PREVIEW','PREVIEW','PENDING','PROCESSING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED'))
);
create index catalog_bulk_jobs_pending on catalog_bulk_jobs(created_at) where status in ('PENDING_PREVIEW','PENDING','PROCESSING');
create table catalog_bulk_items (
 job_id text not null references catalog_bulk_jobs(id) on delete cascade,
 ordinal integer not null, line integer not null, payload jsonb not null,
 plan jsonb, issues jsonb not null default '[]', action text not null default 'pending', done boolean not null default false,
 primary key(job_id,ordinal)
);
create index catalog_bulk_items_work on catalog_bulk_items(job_id,ordinal) where not done;
-- Existing inventory keeps its reason vocabulary. BULK_IMPORT:<job>:<line> in operation_key
-- records origin without changing the stock engine or rewriting historical reason constraints.
