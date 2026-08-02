create table if not exists publication_plans (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  state text not null check (state in ('draft','waiting_for_approval','approved','publishing','published','failed','cancelled','superseded')),
  mode text not null check (mode in ('dry_run','real')),
  idempotency_key text not null,
  source_execution_run_id text,
  source_artifacts jsonb not null,
  policy jsonb not null,
  correlation_id text not null,
  causation_id text,
  trace_id text not null,
  scheduled_at timestamptz,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  published_at timestamptz,
  cancelled_at timestamptz,
  version integer not null default 0,
  unique (tenant_id, workspace_id, idempotency_key)
);

create table if not exists publication_candidates (
  id text primary key,
  publication_id text not null references publication_plans(id),
  tenant_id text not null,
  workspace_id text not null,
  content jsonb not null,
  assets jsonb not null,
  metadata jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists publication_targets (
  id text primary key,
  publication_id text not null references publication_plans(id),
  candidate_id text not null references publication_candidates(id),
  tenant_id text not null,
  workspace_id text not null,
  channel text not null,
  provider text not null,
  mode text not null,
  status text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publication_id, channel, provider, idempotency_key)
);

create table if not exists publication_approvals (
  id text primary key,
  publication_id text not null references publication_plans(id),
  tenant_id text not null,
  workspace_id text not null,
  approved_by_user_id text not null,
  reason text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists publication_attempts (
  id text primary key,
  publication_id text not null references publication_plans(id),
  target_id text not null references publication_targets(id),
  tenant_id text not null,
  workspace_id text not null,
  provider text not null,
  channel text not null,
  attempt_number integer not null,
  state text not null,
  idempotency_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  failure jsonb
);

create table if not exists publication_receipts (
  id text primary key,
  publication_id text not null references publication_plans(id),
  target_id text not null references publication_targets(id),
  attempt_id text not null references publication_attempts(id),
  tenant_id text not null,
  workspace_id text not null,
  provider text not null,
  provider_publication_id text not null,
  channel text not null,
  published_at timestamptz not null,
  status text not null,
  url text not null,
  checksum text not null,
  correlation_id text not null,
  trace_id text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (publication_id, target_id, provider, idempotency_key)
);

create table if not exists publication_events (
  id text primary key,
  publication_id text not null references publication_plans(id),
  event_type text not null,
  target_id text,
  attempt_id text,
  receipt_id text,
  correlation_id text,
  causation_id text,
  trace_id text,
  created_at timestamptz not null default now(),
  payload jsonb
);

create table if not exists publication_failures (
  id bigserial primary key,
  publication_id text not null references publication_plans(id),
  failure jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists publication_schedules (
  id text primary key,
  publication_id text not null references publication_plans(id),
  tenant_id text not null,
  workspace_id text not null,
  scheduled_at timestamptz not null,
  timezone text not null,
  status text not null check (status in ('scheduled','running','completed','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists publication_dead_letters (
  id text primary key,
  publication_id text not null references publication_plans(id),
  tenant_id text not null,
  workspace_id text not null,
  reason text not null,
  last_error jsonb not null,
  attempts integer not null,
  created_at timestamptz not null default now()
);

create table if not exists publication_locks (
  publication_id text primary key,
  owner_id text not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists idx_publication_plans_tenant_workspace_state on publication_plans(tenant_id, workspace_id, state);
create index if not exists idx_publication_schedules_due on publication_schedules(status, scheduled_at);
create index if not exists idx_publication_events_publication on publication_events(publication_id, created_at);
