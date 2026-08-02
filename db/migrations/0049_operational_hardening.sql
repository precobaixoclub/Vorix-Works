create table operational_circuit_breakers (
  id text primary key,
  tenant_id text,
  workspace_id text,
  scope text not null check (scope in ('publication_provider', 'execution_handler', 'webhook', 'analytics', 'system')),
  target text not null,
  state text not null check (state in ('closed', 'open', 'half_open')),
  failure_count integer not null default 0,
  opened_at timestamptz,
  half_open_at timestamptz,
  last_failure_code text,
  last_failure_category text,
  updated_at timestamptz not null
);

create unique index operational_circuit_breakers_unique_scope_idx
  on operational_circuit_breakers (coalesce(tenant_id, ''), coalesce(workspace_id, ''), scope, target);

create index operational_circuit_breakers_state_idx
  on operational_circuit_breakers (state, updated_at desc);

create table operational_rate_limit_buckets (
  bucket_key text primary key,
  route_group text not null,
  tenant_id text,
  principal_id text,
  ip text,
  limit_value integer not null,
  remaining integer not null,
  reset_at timestamptz not null,
  updated_at timestamptz not null
);

create index operational_rate_limit_buckets_scope_idx
  on operational_rate_limit_buckets (route_group, tenant_id, principal_id, reset_at);

create table operational_backpressure_signals (
  id text primary key,
  tenant_id text,
  workspace_id text,
  component text not null check (component in ('publication', 'scheduling', 'analytics', 'webhook', 'system')),
  status text not null check (status in ('inactive', 'active')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  reason text not null,
  safe_message text not null,
  observed_at timestamptz not null,
  details jsonb not null default '{}'::jsonb
);

create index operational_backpressure_signals_scope_idx
  on operational_backpressure_signals (tenant_id, workspace_id, component, status, observed_at desc);

create table operational_slo_snapshots (
  id text primary key,
  tenant_id text,
  workspace_id text,
  metric_id text not null,
  objective numeric not null,
  current_value numeric not null,
  status text not null check (status in ('met', 'at_risk', 'breached')),
  window_label text not null,
  generated_at timestamptz not null
);

create index operational_slo_snapshots_scope_idx
  on operational_slo_snapshots (tenant_id, workspace_id, metric_id, generated_at desc);

create index publication_outbox_operational_idx
  on publication_outbox (tenant_id, workspace_id, status, available_at, provider_id);

create index publication_reconciliations_operational_idx
  on publication_reconciliations (tenant_id, workspace_id, status, created_at);

create index scheduling_occurrences_operational_idx
  on scheduling_schedule_occurrences (tenant_id, workspace_id, status, due_at_utc, lease_until);

create index analytics_events_operational_idx
  on analytics_events (tenant_id, workspace_id, occurred_at, event_type);
