-- 0144 — Vorix Meetings, fundação (Fase 1/2): reunião como entidade PRÓPRIA (não um CalendarEvent),
-- participantes, gravações, transcrição segmentada, análise de IA, fila de jobs, pool de bots de
-- gravação, uso mensal e auditoria. Também adiciona limites comerciais ao entitlement de solução.
--
-- Aditiva e idempotente: só `create ... if not exists`, `add column if not exists` e um insert
-- `on conflict do nothing`. Nenhuma tabela existente perde dado; nenhuma linha é apagada.

-- Limites comerciais por solução/tenant (ex.: Meetings: maxConcurrentRecordings,
-- monthlyRecordingMinutes, meetingRetentionDays, maxStorageBytes). Ausente = default da solução.
alter table solution_entitlements add column if not exists limits jsonb;

create table if not exists meetings (
  id                    text primary key,
  tenant_id             text not null,
  workspace_id          text not null references workspaces (id) on delete cascade,
  owner_user_id         text not null,
  created_by_user_id    text not null,
  title                 text not null,
  description           text,
  -- De onde a reunião nasceu. `calendar` é só UMA das origens: upload, "gravar agora" e link
  -- avulso existem sem nenhum evento de Agenda.
  source                text not null check (source in ('calendar', 'manual', 'external_link', 'upload', 'instant')),
  status                text not null check (status in (
                          'scheduled', 'queued', 'starting', 'waiting_admission', 'recording',
                          'processing', 'transcribing', 'analyzing', 'completed', 'failed', 'cancelled')),
  -- OPCIONAL de propósito (diferente do CMDesk): Meeting sem evento é normal.
  calendar_event_id     text references calendar_events (id) on delete set null,
  meeting_url           text,
  scheduled_start_at    timestamptz,
  scheduled_end_at      timestamptz,
  timezone              text not null default 'America/Sao_Paulo',
  auto_record           boolean not null default false,
  bot_account_id        text,
  bot_joined_at         timestamptz,
  recording_started_at  timestamptz,
  recording_ended_at    timestamptz,
  duration_seconds      integer check (duration_seconds is null or duration_seconds >= 0),
  failure_code          text,
  failure_message       text,
  status_changed_at     timestamptz not null default now(),
  -- Soft delete: nunca hard delete por padrão (gravação/transcrição são dado de negócio).
  deleted_at            timestamptz,
  deleted_by_user_id    text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists meetings_central_idx on meetings (tenant_id, workspace_id, (coalesce(scheduled_start_at, created_at)) desc) where deleted_at is null;
create index if not exists meetings_active_recording_idx on meetings (tenant_id, status) where deleted_at is null and status in ('queued', 'starting', 'waiting_admission', 'recording');
create index if not exists meetings_owner_idx on meetings (tenant_id, workspace_id, owner_user_id) where deleted_at is null;
create index if not exists meetings_title_search_idx on meetings using gin (to_tsvector('simple', title));

create table if not exists meeting_participants (
  id           text primary key,
  meeting_id   text not null references meetings (id) on delete cascade,
  tenant_id    text not null,
  name         text,
  email        text,
  role         text not null default 'attendee' check (role in ('organizer', 'attendee')),
  -- Vínculo OPCIONAL com usuário do tenant ou com Contato do Conversas — nunca obrigatório, sem FK
  -- entre soluções (Meetings funciona sem Conversas).
  user_id      text,
  contact_id   text,
  created_at   timestamptz not null default now(),
  check (name is not null or email is not null)
);
create index if not exists meeting_participants_meeting_idx on meeting_participants (meeting_id);

create table if not exists meeting_recordings (
  id                  text primary key,
  meeting_id          text not null references meetings (id) on delete cascade,
  tenant_id           text not null,
  workspace_id        text not null,
  kind                text not null check (kind in ('original', 'processed')),
  -- Só a CHAVE do storage privado; a URL de leitura é assinada no momento do uso (curta).
  storage_key         text not null,
  mime_type           text not null,
  bytes               bigint not null check (bytes >= 0),
  duration_seconds    numeric(12, 3),
  checksum_sha256     text not null,
  original_file_name  text,
  status              text not null default 'available' check (status in ('available', 'purged', 'failed')),
  purged_at           timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists meeting_recordings_meeting_idx on meeting_recordings (meeting_id);
create index if not exists meeting_recordings_retention_idx on meeting_recordings (tenant_id, created_at) where status = 'available';

create table if not exists meeting_transcripts (
  id              text primary key,
  meeting_id      text not null unique references meetings (id) on delete cascade,
  tenant_id       text not null,
  status          text not null check (status in ('queued', 'running', 'completed', 'failed')),
  language        text,
  engine          text,
  model           text,
  full_text       text,
  segment_count   integer not null default 0,
  processing_ms   integer,
  attempts        integer not null default 0,
  last_error      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- Transcrição SEGMENTADA (não um campo gigante): cada trecho com timestamps e speaker, pesquisável.
create table if not exists meeting_transcript_segments (
  id             text primary key,
  transcript_id  text not null references meeting_transcripts (id) on delete cascade,
  meeting_id     text not null references meetings (id) on delete cascade,
  tenant_id      text not null,
  seq            integer not null,
  start_ms       integer not null check (start_ms >= 0),
  end_ms         integer not null check (end_ms >= start_ms),
  speaker        text,
  text           text not null,
  unique (transcript_id, seq)
);
create index if not exists meeting_transcript_segments_meeting_idx on meeting_transcript_segments (meeting_id, seq);
create index if not exists meeting_transcript_segments_search_idx on meeting_transcript_segments using gin (to_tsvector('simple', text));

create table if not exists meeting_analyses (
  id                    text primary key,
  meeting_id            text not null references meetings (id) on delete cascade,
  tenant_id             text not null,
  workspace_id          text not null,
  status                text not null check (status in ('completed', 'failed', 'blocked_no_credits')),
  -- Resultado estruturado: executiveSummary, topics, decisions, actionItems, nextSteps, risks,
  -- objections, openQuestions.
  result                jsonb,
  operation_code        text not null default 'meeting_ai_analysis',
  credits_charged       integer not null default 0,
  model                 text,
  idempotency_key       text not null unique,
  requested_by_user_id  text,
  error                 text,
  created_at            timestamptz not null default now()
);
create index if not exists meeting_analyses_meeting_idx on meeting_analyses (meeting_id, created_at desc);

-- Fila própria em Postgres (o Vorix não tem Redis; claim com FOR UPDATE SKIP LOCKED). O estado da
-- reunião é persistido em `meetings.status` — a fila nunca é a única fonte de verdade.
create table if not exists meeting_jobs (
  id               text primary key,
  tenant_id        text not null,
  workspace_id     text not null,
  meeting_id       text not null references meetings (id) on delete cascade,
  kind             text not null check (kind in ('record', 'transcribe', 'analyze', 'purge_media')),
  status           text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  run_at           timestamptz not null default now(),
  attempts         integer not null default 0,
  max_attempts     integer not null default 3,
  locked_by        text,
  locked_until     timestamptz,
  last_error       text,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists meeting_jobs_due_idx on meeting_jobs (kind, run_at) where status = 'queued';
create index if not exists meeting_jobs_meeting_idx on meeting_jobs (meeting_id);

-- Pool de contas Google DEDICADAS de gravação (nunca a conta pessoal do cliente). Global da
-- plataforma; a sessão/credencial vive no secret manager (`credential_secret_ref`), nunca aqui.
create table if not exists recorder_bot_accounts (
  id                     text primary key,
  label                  text not null,
  google_email           text not null unique,
  status                 text not null default 'disabled' check (status in ('active', 'busy', 'invalid_session', 'disabled', 'error')),
  credential_secret_ref  text,
  current_meeting_id     text,
  current_tenant_id      text,
  last_used_at           timestamptz,
  last_health_check_at   timestamptz,
  health                 jsonb not null default '{}'::jsonb,
  consecutive_failures   integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
-- Um bot nunca grava duas reuniões; uma reunião nunca tem dois bots.
create unique index if not exists recorder_bot_accounts_current_meeting_uidx on recorder_bot_accounts (current_meeting_id) where current_meeting_id is not null;

create table if not exists meeting_usage_monthly (
  tenant_id              text not null,
  period                 text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  recording_seconds      bigint not null default 0,
  meetings_recorded      integer not null default 0,
  transcription_seconds  bigint not null default 0,
  storage_bytes          bigint not null default 0,
  ai_analyses            integer not null default 0,
  concurrent_peak        integer not null default 0,
  updated_at             timestamptz not null default now(),
  primary key (tenant_id, period)
);

-- Auditoria de ações sensíveis (acesso a gravação, exclusão, purga de retenção, upload...).
create table if not exists meeting_audit_log (
  id             text primary key,
  tenant_id      text not null,
  workspace_id   text,
  meeting_id     text,
  actor_user_id  text,
  action         text not null,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists meeting_audit_log_meeting_idx on meeting_audit_log (tenant_id, meeting_id, created_at desc);

-- Custo da análise de reunião no catálogo CENTRAL de créditos (editável pelo admin; nunca
-- hardcoded no código). Mesma carteira de créditos do Vorix — sem carteira paralela.
insert into ai_operation_types (code, label, capability, credits_cost, default_provider_code, default_model_id)
values ('meeting_ai_analysis', 'Vorix Meetings — análise da reunião (resumo, decisões, tarefas)', 'text_generation', 2, 'anthropic', 'claude-haiku-4-5-20251001')
on conflict (code) do nothing;
