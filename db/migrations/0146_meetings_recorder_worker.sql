-- 0146 - Vorix Meetings, rodada 3: recorder isolado, sessoes Google criptografadas,
-- supervisao de processos, cancelamento e metadados tecnicos do arquivo capturado.
-- Aditiva e idempotente; nenhum dado anterior e removido.

alter table recorder_bot_accounts add column if not exists display_name text not null default 'Vorix Recorder';
alter table recorder_bot_accounts add column if not exists encrypted_session_state text;
alter table recorder_bot_accounts add column if not exists current_recording_id text;
alter table recorder_bot_accounts add column if not exists last_error text;
alter table recorder_bot_accounts add column if not exists session_updated_at timestamptz;
create unique index if not exists recorder_bot_accounts_current_recording_uidx
  on recorder_bot_accounts (current_recording_id) where current_recording_id is not null;

alter table meeting_jobs add column if not exists cancel_requested_at timestamptz;
alter table meeting_jobs add column if not exists cancel_requested_by text;

alter table meeting_recordings add column if not exists video_codec text;
alter table meeting_recordings add column if not exists audio_codec text;
alter table meeting_recordings add column if not exists width integer check (width is null or width > 0);
alter table meeting_recordings add column if not exists height integer check (height is null or height > 0);

create table if not exists meeting_recorder_runs (
  id                   text primary key,
  tenant_id            text not null,
  workspace_id         text not null,
  meeting_id           text not null references meetings (id) on delete cascade,
  recording_id         text,
  job_id               text not null unique references meeting_jobs (id) on delete cascade,
  bot_account_id       text not null references recorder_bot_accounts (id),
  worker_id            text not null,
  state                text not null check (state in (
                         'starting', 'waiting_admission', 'recording', 'processing',
                         'completed', 'failed', 'cancelled')),
  browser_pid          integer,
  ffmpeg_pid           integer,
  virtual_display      text,
  audio_sink           text,
  temp_dir             text,
  started_at           timestamptz not null default now(),
  heartbeat_at         timestamptz not null default now(),
  actual_joined_at     timestamptz,
  ended_at             timestamptz,
  error_code           text,
  error_message        text,
  ffmpeg_exit_code     integer,
  browser_exit_reason  text,
  bytes_produced       bigint,
  duration_seconds     numeric(12, 3),
  metrics              jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists meeting_recorder_runs_active_idx
  on meeting_recorder_runs (heartbeat_at) where state in ('starting', 'waiting_admission', 'recording', 'processing');
create index if not exists meeting_recorder_runs_meeting_idx
  on meeting_recorder_runs (tenant_id, workspace_id, meeting_id, created_at desc);

create table if not exists meeting_recorder_events (
  id            text primary key,
  run_id        text not null references meeting_recorder_runs (id) on delete cascade,
  meeting_id    text not null,
  recording_id  text,
  state         text not null,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists meeting_recorder_events_run_idx
  on meeting_recorder_events (run_id, created_at);

alter table meeting_usage_monthly add column if not exists bot_wait_seconds bigint not null default 0;
alter table meeting_usage_monthly add column if not exists admission_wait_seconds bigint not null default 0;
alter table meeting_usage_monthly add column if not exists capture_failures integer not null default 0;
alter table meeting_usage_monthly add column if not exists browser_failures integer not null default 0;
alter table meeting_usage_monthly add column if not exists ffmpeg_failures integer not null default 0;
alter table meeting_usage_monthly add column if not exists bytes_recorded bigint not null default 0;
