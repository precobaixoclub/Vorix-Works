create table execution_runs (
  id                         text primary key,
  runtime_plan_id            text not null references runtime_plans (id) on delete cascade,
  planning_id                text not null references planning (id) on delete cascade,
  tenant_id                  text not null,
  workspace_id               text not null references workspaces (id) on delete cascade,
  state                      text not null,
  mode                       text not null,
  idempotency_key            text not null,
  source_graph_fingerprint   text not null,
  runtime_fingerprint        text not null,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,
  started_at                 timestamptz,
  finished_at                timestamptz,
  cancelled_at               timestamptz,
  version                    int not null default 1,

  constraint execution_runs_state_check check (state in ('created', 'validating', 'ready', 'running', 'waiting_for_approval', 'completed', 'failed', 'cancelled')),
  constraint execution_runs_mode_check check (mode in ('dry_run', 'real')),
  constraint execution_runs_version_positive check (version > 0)
);

create unique index execution_runs_runtime_idempotency_uq on execution_runs (runtime_plan_id, idempotency_key);
create index execution_runs_tenant_workspace_created_idx on execution_runs (tenant_id, workspace_id, created_at desc);

create table execution_task_runs (
  id                  text primary key,
  execution_run_id    text not null references execution_runs (id) on delete cascade,
  runtime_plan_id     text not null references runtime_plans (id) on delete cascade,
  runtime_task_id     text not null references runtime_tasks (id) on delete cascade,
  execution_task_id   text not null references execution_tasks (id) on delete cascade,
  type                text not null,
  capability          text not null,
  state               text not null,
  blocked_reason      text,
  attempts_count      int not null default 0,
  created_at          timestamptz not null,
  updated_at          timestamptz not null,
  started_at          timestamptz,
  finished_at         timestamptz,
  version             int not null default 1,

  constraint execution_task_runs_state_check check (state in ('blocked', 'ready', 'running', 'waiting_for_approval', 'completed', 'failed', 'skipped', 'cancelled')),
  constraint execution_task_runs_type_check check (type in ('research', 'campaign_structure', 'copy_generation', 'visual_generation', 'approval', 'publication')),
  constraint execution_task_runs_capability_check check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution')),
  constraint execution_task_runs_attempts_non_negative check (attempts_count >= 0),
  constraint execution_task_runs_version_positive check (version > 0)
);

create unique index execution_task_runs_run_runtime_task_uq on execution_task_runs (execution_run_id, runtime_task_id);
create unique index execution_task_runs_running_task_uq on execution_task_runs (execution_run_id, runtime_task_id) where state = 'running';
create index execution_task_runs_run_id_idx on execution_task_runs (execution_run_id);

create table execution_attempts (
  id                  text primary key,
  execution_run_id    text not null references execution_runs (id) on delete cascade,
  task_run_id         text not null references execution_task_runs (id) on delete cascade,
  attempt_number      int not null,
  state               text not null,
  started_at          timestamptz not null,
  finished_at         timestamptz,
  failure             jsonb,
  idempotency_key     text not null,

  constraint execution_attempts_state_check check (state in ('running', 'completed', 'failed')),
  constraint execution_attempts_number_positive check (attempt_number > 0)
);

create unique index execution_attempts_task_attempt_uq on execution_attempts (task_run_id, attempt_number);
create index execution_attempts_run_id_idx on execution_attempts (execution_run_id);

create table execution_artifacts (
  id                    text primary key,
  execution_run_id      text not null references execution_runs (id) on delete cascade,
  runtime_plan_id       text not null references runtime_plans (id) on delete cascade,
  tenant_id             text not null,
  workspace_id          text not null references workspaces (id) on delete cascade,
  artifact_type         text not null,
  schema_id             text not null,
  schema_version        int not null,
  producer_task_run_id  text not null references execution_task_runs (id) on delete cascade,
  output_port           text not null,
  payload               jsonb,
  payload_ref           text,
  checksum              text not null,
  created_at            timestamptz not null,

  constraint execution_artifacts_type_check check (artifact_type in ('text', 'image', 'video', 'carousel', 'document')),
  constraint execution_artifacts_schema_version_positive check (schema_version > 0)
);

create unique index execution_artifacts_task_output_uq on execution_artifacts (producer_task_run_id, output_port);
create index execution_artifacts_run_id_idx on execution_artifacts (execution_run_id);

create table execution_events (
  id                  text primary key,
  execution_run_id    text not null references execution_runs (id) on delete cascade,
  event_type          text not null,
  task_run_id         text references execution_task_runs (id) on delete cascade,
  gate_id             text,
  created_at          timestamptz not null,
  payload             jsonb,

  constraint execution_events_type_check check (event_type in (
    'run_created', 'run_started', 'task_ready', 'task_started', 'task_completed', 'task_failed',
    'artifact_produced', 'gate_created', 'gate_resolved', 'retry_scheduled', 'run_completed',
    'run_failed', 'run_cancelled'
  ))
);

create index execution_events_run_created_idx on execution_events (execution_run_id, created_at);

create table execution_gates (
  id                  text primary key,
  execution_run_id    text not null references execution_runs (id) on delete cascade,
  task_run_id         text not null references execution_task_runs (id) on delete cascade,
  state               text not null,
  decision            text,
  created_at          timestamptz not null,
  resolved_at         timestamptz,
  decided_by_user_id  text,

  constraint execution_gates_state_check check (state in ('open', 'approved', 'rejected')),
  constraint execution_gates_decision_check check (decision is null or decision in ('approved', 'rejected'))
);

create unique index execution_gates_task_open_uq on execution_gates (task_run_id) where state = 'open';
create index execution_gates_run_id_idx on execution_gates (execution_run_id);
