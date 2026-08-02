create table if not exists analytics_events (
  event_id text not null,
  event_type text not null,
  event_version integer not null,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null,
  tenant_id text not null,
  workspace_id text not null,
  campaign_id text,
  planning_id text,
  execution_run_id text,
  publication_id text,
  publication_receipt_id text,
  schedule_id text,
  occurrence_id text,
  provider_id text,
  target_id text,
  correlation_id text not null,
  causation_id text,
  dimensions jsonb not null,
  measurements jsonb not null,
  source text not null,
  source_type text not null,
  schema_version integer not null,
  compensates_event_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, event_id)
);

create table if not exists analytics_metric_registry (
  metric_id text primary key,
  definition jsonb not null,
  status text not null,
  version integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists analytics_metrics (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  metric_id text not null,
  dimensions jsonb not null,
  value double precision not null,
  measured_at timestamptz not null,
  source_event_id text,
  created_at timestamptz not null default now()
);

create table if not exists analytics_snapshots (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  snapshot_period text not null check (snapshot_period in ('hourly','daily','weekly','monthly')),
  period_start_utc timestamptz not null,
  period_end_utc timestamptz not null,
  timezone text not null,
  metric_id text not null,
  dimensions jsonb not null,
  dimensions_hash text not null,
  value double precision not null,
  source_event_count integer not null,
  rebuilt_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, snapshot_period, period_start_utc, metric_id, dimensions_hash)
);

create table if not exists analytics_aggregations (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  metric_id text not null,
  dimensions jsonb not null,
  value double precision not null,
  source_event_count integer not null,
  period_start_utc timestamptz not null,
  period_end_utc timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists analytics_provider_metric_snapshots (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  external_publication_id text not null,
  metric_name text not null,
  metric_value double precision not null,
  metric_unit text not null,
  captured_at timestamptz not null,
  source_timestamp timestamptz,
  is_estimated boolean not null,
  is_final boolean not null,
  metadata jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists analytics_insights (
  insight_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  type text not null,
  severity text not null check (severity in ('info','warning','critical')),
  title text not null,
  description text not null,
  evidence jsonb not null,
  metric_references text[] not null,
  period jsonb not null,
  generated_at timestamptz not null,
  status text not null check (status in ('active','dismissed','resolved'))
);

create table if not exists analytics_alert_rules (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  metric_id text not null,
  threshold double precision not null,
  comparison text not null check (comparison in ('gt','gte','lt','lte')),
  severity text not null check (severity in ('info','warning','critical')),
  enabled boolean not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists analytics_alert_occurrences (
  id text primary key,
  rule_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  status text not null check (status in ('active','acknowledged','resolved','dismissed')),
  severity text not null check (severity in ('info','warning','critical')),
  title text not null,
  description text not null,
  metric_id text not null,
  value double precision not null,
  triggered_at timestamptz not null,
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

create table if not exists analytics_exports (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  format text not null check (format in ('csv','json')),
  status text not null check (status in ('pending','completed','failed','expired')),
  filters jsonb not null,
  requested_by_user_id text not null,
  requested_at timestamptz not null,
  completed_at timestamptz,
  expires_at timestamptz,
  failure_code text
);

create table if not exists analytics_export_artifacts (
  id text primary key,
  export_job_id text not null references analytics_exports(id) on delete cascade,
  tenant_id text not null,
  workspace_id text not null,
  content_type text not null,
  body text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists analytics_dead_letters (
  id text primary key,
  tenant_id text not null,
  workspace_id text,
  event_id text,
  reason text not null,
  safe_message text not null,
  payload_digest text,
  status text not null check (status in ('pending','reprocessed','ignored')),
  created_at timestamptz not null default now(),
  reprocessed_at timestamptz
);

create table if not exists analytics_data_quality_reports (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  status text not null check (status in ('healthy','warning','critical')),
  generated_at timestamptz not null,
  issues jsonb not null
);

create index if not exists idx_analytics_events_workspace_occurred on analytics_events(tenant_id, workspace_id, occurred_at);
create index if not exists idx_analytics_events_type on analytics_events(event_type);
create index if not exists idx_analytics_events_provider on analytics_events(provider_id, occurred_at);
create index if not exists idx_analytics_events_campaign on analytics_events(campaign_id, occurred_at);
create index if not exists idx_analytics_events_publication on analytics_events(publication_id);
create index if not exists idx_analytics_events_schedule on analytics_events(schedule_id);
create index if not exists idx_analytics_metrics_workspace on analytics_metrics(tenant_id, workspace_id, metric_id, measured_at);
create index if not exists idx_analytics_snapshots_workspace on analytics_snapshots(tenant_id, workspace_id, snapshot_period, period_start_utc);
create index if not exists idx_analytics_snapshots_metric on analytics_snapshots(metric_id);
create index if not exists idx_analytics_provider_snapshots_workspace on analytics_provider_metric_snapshots(tenant_id, workspace_id, provider_id, captured_at);
create index if not exists idx_analytics_insights_workspace on analytics_insights(tenant_id, workspace_id, generated_at);
create index if not exists idx_analytics_alert_occurrences_workspace on analytics_alert_occurrences(tenant_id, workspace_id, status, triggered_at);
create index if not exists idx_analytics_exports_workspace on analytics_exports(tenant_id, workspace_id, requested_at);
create index if not exists idx_analytics_dead_letters_workspace on analytics_dead_letters(tenant_id, workspace_id, created_at);
create index if not exists idx_analytics_data_quality_workspace on analytics_data_quality_reports(tenant_id, workspace_id, generated_at);
