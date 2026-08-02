alter table execution_artifacts add column if not exists handler_id text;
alter table execution_artifacts add column if not exists provider text;
alter table execution_artifacts add column if not exists parent_artifact_ids text[] not null default '{}';

create table execution_traces (
  id                text primary key,
  execution_run_id  text not null references execution_runs (id) on delete cascade,
  task_run_id       text not null references execution_task_runs (id) on delete cascade,
  attempt_id        text not null references execution_attempts (id) on delete cascade,
  capability        text not null,
  handler           text not null,
  provider          text not null,
  handler_version   text not null,
  started_at        timestamptz not null,
  finished_at       timestamptz not null,
  duration_ms       int not null,
  retry_attempt     int not null,
  warnings          text[] not null default '{}',
  success           boolean not null,

  constraint execution_traces_capability_check check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution')),
  constraint execution_traces_duration_non_negative check (duration_ms >= 0),
  constraint execution_traces_retry_attempt_positive check (retry_attempt > 0)
);

create index execution_traces_run_started_idx on execution_traces (execution_run_id, started_at);
