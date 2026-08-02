create table if not exists scheduling_publication_schedules (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  publication_plan_id text not null,
  publication_candidate_id text not null,
  provider_id text not null,
  target_id text not null,
  status text not null check (status in ('draft','scheduled','paused','due','dispatching','completed','cancelled','expired','failed')),
  timezone text not null,
  scheduled_at_utc timestamptz,
  scheduled_at_local text,
  governance_policy_reference text,
  credential_reference_id text,
  campaign_id text,
  content_checksum text,
  missed_policy text not null check (missed_policy in ('skip','dispatch_immediately','reschedule_next_window','manual_review')),
  allow_degraded_provider boolean not null default false,
  max_attempts integer not null default 3,
  created_by_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paused_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  version integer not null default 0
);

create table if not exists scheduling_schedule_rules (
  id text primary key,
  schedule_id text not null references scheduling_publication_schedules(id) on delete cascade,
  tenant_id text not null,
  workspace_id text not null,
  frequency text not null check (frequency in ('once','daily','weekly','monthly','custom_interval')),
  start_at_local text not null,
  start_at_utc timestamptz not null,
  timezone text not null,
  interval integer not null check (interval > 0),
  end_at_local text,
  end_at_utc timestamptz,
  count integer,
  days_of_week integer[],
  day_of_month integer,
  window_days integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scheduling_schedule_occurrences (
  id text primary key,
  schedule_id text not null references scheduling_publication_schedules(id) on delete cascade,
  occurrence_key text not null,
  occurrence_number integer not null,
  tenant_id text not null,
  workspace_id text not null,
  publication_plan_id text not null,
  publication_candidate_id text not null,
  provider_id text not null,
  target_id text not null,
  status text not null check (status in ('pending','claimed','dispatched','completed','cancelled','missed','failed','dead_lettered')),
  due_at_utc timestamptz not null,
  local_date_time text not null,
  timezone text not null,
  idempotency_key text not null,
  credential_reference_id text,
  governance_policy_reference text,
  campaign_id text,
  content_checksum text,
  claimed_by text,
  claimed_at timestamptz,
  lease_until timestamptz,
  fencing_token integer not null default 0,
  attempt_count integer not null default 0,
  last_failure_code text,
  last_error text,
  execution_reference jsonb,
  audit_reference jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  missed_at timestamptz,
  unique (idempotency_key),
  unique (schedule_id, occurrence_key)
);

create table if not exists scheduling_schedule_conflicts (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  schedule_id text not null,
  occurrence_id text,
  severity text not null check (severity in ('info','warning','blocking')),
  code text not null,
  safe_message text not null,
  conflicting_schedule_id text,
  conflicting_occurrence_id text,
  provider_id text,
  target_id text,
  conflict_window jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists scheduling_schedule_claims (
  id bigserial primary key,
  occurrence_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  worker_id text not null,
  claimed_at timestamptz not null,
  lease_until timestamptz not null,
  fencing_token integer not null,
  created_at timestamptz not null default now()
);

create table if not exists scheduling_schedule_dead_letters (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  schedule_id text not null,
  occurrence_id text not null,
  failure_code text not null,
  failure_category text not null check (failure_category in ('policy','credential','provider','dispatch','timeout','internal')),
  attempt_count integer not null,
  last_error text not null,
  next_action text not null check (next_action in ('manual_review','reprocess','ignore')),
  created_at timestamptz not null default now(),
  reprocessed_at timestamptz,
  reprocessed_by_user_id text
);

create table if not exists scheduling_schedule_events (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  schedule_id text,
  occurrence_id text,
  event_type text not null,
  actor_user_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_scheduling_schedules_workspace on scheduling_publication_schedules(tenant_id, workspace_id);
create index if not exists idx_scheduling_schedules_status on scheduling_publication_schedules(status);
create index if not exists idx_scheduling_schedules_provider on scheduling_publication_schedules(provider_id);
create index if not exists idx_scheduling_occurrences_workspace_due on scheduling_schedule_occurrences(tenant_id, workspace_id, due_at_utc);
create index if not exists idx_scheduling_occurrences_status_due on scheduling_schedule_occurrences(status, due_at_utc);
create index if not exists idx_scheduling_occurrences_schedule on scheduling_schedule_occurrences(schedule_id);
create index if not exists idx_scheduling_occurrences_provider on scheduling_schedule_occurrences(provider_id);
create index if not exists idx_scheduling_occurrences_target on scheduling_schedule_occurrences(target_id);
create index if not exists idx_scheduling_occurrences_lease on scheduling_schedule_occurrences(lease_until);
create index if not exists idx_scheduling_conflicts_workspace on scheduling_schedule_conflicts(tenant_id, workspace_id, schedule_id);
create index if not exists idx_scheduling_dead_letters_workspace on scheduling_schedule_dead_letters(tenant_id, workspace_id, created_at);
create index if not exists idx_scheduling_events_workspace on scheduling_schedule_events(tenant_id, workspace_id, created_at);
