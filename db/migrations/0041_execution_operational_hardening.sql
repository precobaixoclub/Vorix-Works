alter table execution_runs add column if not exists correlation_id text;
alter table execution_runs add column if not exists causation_id text;
alter table execution_runs add column if not exists trace_id text;

alter table execution_task_runs add column if not exists correlation_id text;
alter table execution_task_runs add column if not exists causation_id text;
alter table execution_task_runs add column if not exists trace_id text;

alter table execution_attempts add column if not exists correlation_id text;
alter table execution_attempts add column if not exists causation_id text;
alter table execution_attempts add column if not exists trace_id text;

alter table execution_events add column if not exists correlation_id text;
alter table execution_events add column if not exists causation_id text;
alter table execution_events add column if not exists trace_id text;

alter table execution_handler_resolution_events add column if not exists correlation_id text;
alter table execution_handler_resolution_events add column if not exists causation_id text;
alter table execution_handler_resolution_events add column if not exists trace_id text;

alter table execution_traces add column if not exists correlation_id text;
alter table execution_traces add column if not exists causation_id text;
alter table execution_traces add column if not exists trace_id text;

alter table execution_events drop constraint if exists execution_events_type_check;
alter table execution_events add constraint execution_events_type_check check (event_type in (
  'run_created',
  'run_started',
  'task_ready',
  'task_started',
  'task_completed',
  'task_failed',
  'artifact_produced',
  'gate_created',
  'gate_resolved',
  'retry_scheduled',
  'run_completed',
  'run_failed',
  'run_cancelled',
  'side_effect_blocked'
));

alter table execution_handler_resolution_events drop constraint if exists execution_handler_resolution_fallback_check;
alter table execution_artifacts drop constraint if exists execution_artifacts_side_effect_check;

create index if not exists execution_events_trace_idx on execution_events (trace_id);
create index if not exists execution_traces_trace_idx on execution_traces (trace_id);
