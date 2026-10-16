-- Conversas: menu de triagem (chatbot) — o cliente escolhe uma opção ("1 Vendas, 2 Suporte") e a
-- conversa vai para a equipe/etiqueta daquela opção. Ver src/domain/inbox/service-settings.ts.

alter table inbox_service_settings add column if not exists triage_enabled boolean not null default false;
alter table inbox_service_settings add column if not exists triage_greeting text not null default 'Olá! Para te atender mais rápido, escolha uma opção:';
alter table inbox_service_settings add column if not exists triage_options jsonb not null default '[]'::jsonb;
alter table inbox_service_settings add column if not exists triage_fallback_message text not null default 'Tudo bem! Vamos te encaminhar para um atendente.';

alter table inbox_conversations add column if not exists triage_status text;
alter table inbox_conversations add column if not exists triage_attempts smallint not null default 0;
alter table inbox_conversations add column if not exists triage_option text;
alter table inbox_conversations add column if not exists triage_menu_sent_at timestamptz;
-- Só conversas criadas DEPOIS de ligar a triagem recebem o menu (as em andamento seguem como estão).
alter table inbox_service_settings add column if not exists triage_enabled_at timestamptz;

alter table inbox_conversations drop constraint if exists inbox_conversations_triage_status_check;
alter table inbox_conversations add constraint inbox_conversations_triage_status_check
  check (triage_status is null or triage_status in ('awaiting', 'completed', 'skipped'));

alter table inbox_conversation_events drop constraint if exists inbox_conversation_events_type_check;
alter table inbox_conversation_events add constraint inbox_conversation_events_type_check
  check (type in (
    'assigned', 'unassigned', 'took_over', 'transferred', 'status_changed', 'ai_paused', 'ai_resumed',
    'ai_response_sent', 'ai_response_failed', 'ai_response_cancelled', 'ai_response_skipped_insufficient_credits',
    'kanban_phase_changed', 'note_added', 'csat_answered', 'away_message_sent', 'triage_completed', 'triage_skipped'
  ));
