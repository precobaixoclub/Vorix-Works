-- Conversas: horário de atendimento + mensagem de ausência, motivos de encerramento e pesquisa de
-- satisfação (CSAT 1–5). Ver src/domain/inbox/service-settings.ts.

create table if not exists inbox_service_settings (
  workspace_id text primary key references workspaces (id) on delete cascade,
  tenant_id text not null,
  timezone text not null default 'America/Sao_Paulo',
  business_hours jsonb not null,
  away_enabled boolean not null default false,
  away_message text not null,
  closing_reasons jsonb not null default '[]'::jsonb,
  require_closing_reason boolean not null default false,
  csat_enabled boolean not null default false,
  csat_message text not null,
  csat_thanks_message text not null,
  updated_at timestamptz not null default now()
);

alter table inbox_conversations add column if not exists closing_reason text;
alter table inbox_conversations add column if not exists closed_at timestamptz;
alter table inbox_conversations add column if not exists closed_by text;
alter table inbox_conversations add column if not exists csat_status text;
alter table inbox_conversations add column if not exists csat_requested_at timestamptz;
alter table inbox_conversations add column if not exists csat_score smallint;
alter table inbox_conversations add column if not exists csat_answered_at timestamptz;
alter table inbox_conversations add column if not exists last_away_message_at timestamptz;

alter table inbox_conversations drop constraint if exists inbox_conversations_csat_status_check;
alter table inbox_conversations add constraint inbox_conversations_csat_status_check
  check (csat_status is null or csat_status in ('awaiting', 'answered', 'expired'));
alter table inbox_conversations drop constraint if exists inbox_conversations_csat_score_check;
alter table inbox_conversations add constraint inbox_conversations_csat_score_check
  check (csat_score is null or csat_score between 1 and 5);

create index if not exists inbox_conversations_closed_idx on inbox_conversations (workspace_id, closed_at) where closed_at is not null;

-- Constraint dos eventos acompanha o enum TypeScript (ver 0125/0150).
alter table inbox_conversation_events drop constraint if exists inbox_conversation_events_type_check;
alter table inbox_conversation_events add constraint inbox_conversation_events_type_check
  check (type in (
    'assigned', 'unassigned', 'took_over', 'transferred', 'status_changed', 'ai_paused', 'ai_resumed',
    'ai_response_sent', 'ai_response_failed', 'ai_response_cancelled', 'ai_response_skipped_insufficient_credits',
    'kanban_phase_changed', 'note_added', 'csat_answered', 'away_message_sent'
  ));
