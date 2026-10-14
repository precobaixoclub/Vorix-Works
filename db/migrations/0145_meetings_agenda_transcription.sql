-- 0145 — Vorix Meetings, rodada 2: Agenda (evolução da 0127, nunca uma segunda Agenda), sync com
-- Google Calendar sem last-write-wins, fila com lease/heartbeat, transcrição idempotente por
-- gravação, itens de ação estruturados e preparação de auto-gravação.
--
-- Aditiva e idempotente. As tabelas da 0127 nunca foram expostas (sem rotas), então os CHECKs
-- novos entram NOT VALID por segurança e são validados em seguida — nenhuma linha é apagada.

-- ── Agenda (calendar_events, 0127) ───────────────────────────────────────────────────────────
alter table calendar_events add column if not exists meet_link text;
-- Recorrência: o pull usa singleEvents=true — cada OCORRÊNCIA vira sua própria linha, com o id da
-- instância do Google (`<mestre>_<início>`) e a referência ao mestre. Nunca colapsa no mestre.
alter table calendar_events add column if not exists google_recurring_event_id text;
alter table calendar_events add column if not exists google_original_start_at timestamptz;
-- Versão local x versão sincronizada: edição local incrementa `local_version`; o push só marca
-- `synced_version` se nada mudou durante o envio. `local_version > synced_version` = pendente.
alter table calendar_events add column if not exists local_version integer not null default 0;
alter table calendar_events add column if not exists synced_version integer not null default 0;
-- Conflito: snapshot do evento remoto que divergiu de uma edição local ainda não enviada.
alter table calendar_events add column if not exists conflict_remote jsonb;
alter table calendar_events add column if not exists wants_meet_link boolean not null default false;
alter table calendar_events add column if not exists sync_to_google boolean not null default true;

alter table calendar_events drop constraint if exists calendar_events_sync_state_check;
alter table calendar_events add constraint calendar_events_sync_state_check check (sync_state in ('ok', 'failed', 'pending', 'conflict')) not valid;
alter table calendar_events validate constraint calendar_events_sync_state_check;
-- `related_entity_type` deixa de ser texto livre (bug herdado do CMDesk): só tipos conhecidos.
alter table calendar_events drop constraint if exists calendar_events_related_entity_type_check;
alter table calendar_events add constraint calendar_events_related_entity_type_check check (related_entity_type is null or related_entity_type in ('meeting')) not valid;
alter table calendar_events validate constraint calendar_events_related_entity_type_check;

create index if not exists calendar_events_dirty_idx on calendar_events (google_account_id, owner_user_id) where local_version > synced_version;
create index if not exists calendar_events_recurring_idx on calendar_events (google_account_id, google_recurring_event_id) where google_recurring_event_id is not null;

-- ── Conexão Google (calendar_connections, 0127) ──────────────────────────────────────────────
-- Lease de sync no PRÓPRIO registro (lock distribuído sem Redis): um processo só sincroniza a
-- conta se conseguir o lease; se morrer, o lease expira e outro assume.
alter table calendar_connections add column if not exists sync_lease_owner text;
alter table calendar_connections add column if not exists sync_lease_until timestamptz;
alter table calendar_connections add column if not exists next_sync_at timestamptz;
alter table calendar_connections add column if not exists last_error_at timestamptz;
alter table calendar_connections add column if not exists consecutive_failures integer not null default 0;
create index if not exists calendar_connections_due_idx on calendar_connections (next_sync_at) where status = 'connected';

-- Observabilidade do sync: toda ação de pull/push/conflito/erro fica registrada.
create table if not exists calendar_sync_log (
  id               text primary key,
  tenant_id        text not null,
  workspace_id     text not null,
  connection_id    text not null,
  event_id         text,
  google_event_id  text,
  direction        text not null check (direction in ('pull', 'push', 'auth', 'sync')),
  action           text not null,
  status           text not null check (status in ('ok', 'skipped', 'conflict', 'error')),
  error            text,
  created_at       timestamptz not null default now()
);
create index if not exists calendar_sync_log_connection_idx on calendar_sync_log (connection_id, created_at desc);

-- ── Meetings: auto-gravação (preparação; gravação real segue desligada) ──────────────────────
alter table meetings add column if not exists join_before_minutes integer check (join_before_minutes is null or join_before_minutes between 0 and 30);
alter table meetings add column if not exists join_grace_minutes integer check (join_grace_minutes is null or join_grace_minutes between 0 and 60);
alter table meetings add column if not exists auto_record_evaluated_at timestamptz;
alter table meetings add column if not exists auto_record_outcome text;
create index if not exists meetings_auto_record_due_idx on meetings (scheduled_start_at) where auto_record and status = 'scheduled' and deleted_at is null and auto_record_evaluated_at is null;

-- ── Fila: lease + heartbeat + idempotência por gravação/operação ─────────────────────────────
alter table meeting_jobs add column if not exists recording_id text;
alter table meeting_jobs add column if not exists claimed_at timestamptz;
alter table meeting_jobs add column if not exists heartbeat_at timestamptz;
-- `run_at` = próxima tentativa elegível (nextAttemptAt); `locked_by`/`locked_until` = claim/lease.
create unique index if not exists meeting_jobs_active_recording_uidx on meeting_jobs (recording_id, kind) where recording_id is not null and status in ('queued', 'running');
create unique index if not exists meeting_jobs_active_analyze_uidx on meeting_jobs (meeting_id, kind) where kind = 'analyze' and status in ('queued', 'running');
create index if not exists meeting_jobs_lease_idx on meeting_jobs (kind, locked_until) where status = 'running';

alter table meeting_transcripts add column if not exists recording_id text;
alter table meeting_transcript_segments add column if not exists confidence numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1));

-- Tarefas/decisões ESTRUTURADAS da análise (não só texto renderizado). Nada vira tarefa real sem
-- confirmação: tudo nasce `suggested`.
create table if not exists meeting_action_items (
  id                  text primary key,
  meeting_id          text not null references meetings (id) on delete cascade,
  analysis_id         text not null references meeting_analyses (id) on delete cascade,
  tenant_id           text not null,
  workspace_id        text not null,
  type                text not null check (type in ('decision', 'task', 'next_step')),
  description         text not null,
  assignee_name       text,
  due_date            text,
  source_timestamp_ms integer check (source_timestamp_ms is null or source_timestamp_ms >= 0),
  confidence          numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status              text not null default 'suggested' check (status in ('suggested', 'confirmed', 'dismissed')),
  decided_by_user_id  text,
  decided_at          timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists meeting_action_items_meeting_idx on meeting_action_items (meeting_id, analysis_id);

alter table meeting_analyses add column if not exists transcript_id text;
alter table meeting_analyses add column if not exists job_id text;
