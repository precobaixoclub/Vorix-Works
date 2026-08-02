alter table execution_runs drop constraint if exists execution_runs_mode_check;
alter table execution_runs add constraint execution_runs_mode_check check (mode in ('dry_run', 'real'));

create table execution_handler_resolution_events (
  id                    text primary key,
  execution_run_id      text not null references execution_runs (id) on delete cascade,
  task_run_id           text not null references execution_task_runs (id) on delete cascade,
  capability            text not null,
  handler               text not null,
  provider              text not null,
  handler_version       text not null,
  feature_flags         jsonb not null,
  execution_mode        text not null,
  mapping_version       int,
  skill_capability      text,
  fallback_policy       text not null,
  created_at            timestamptz not null,

  constraint execution_handler_resolution_capability_check check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution')),
  constraint execution_handler_resolution_mode_check check (execution_mode in ('dry_run', 'real')),
  constraint execution_handler_resolution_fallback_check check (fallback_policy in ('fail_closed', 'deterministic_fallback'))
);

create index execution_handler_resolution_run_created_idx on execution_handler_resolution_events (execution_run_id, created_at);
