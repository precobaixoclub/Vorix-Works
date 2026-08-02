-- Sprint 07 (Fase 10/11) — dois estados novos de conversa (`collecting_briefing`,
-- `awaiting_confirmation`) e 13 tipos novos de evento do fluxo de Briefing. Migrations já
-- aplicadas (0014/0015) nunca são editadas — os checks são substituídos aqui.
alter table conversations drop constraint conversations_state_check;
alter table conversations add constraint conversations_state_check check (state in (
  'idle', 'processing', 'awaiting_context', 'waiting_action', 'resolved',
  'collecting_briefing', 'awaiting_confirmation'
));

alter table conversation_events drop constraint conversation_events_event_type_check;
alter table conversation_events add constraint conversation_events_event_type_check check (event_type in (
  'user_message', 'intent_classified', 'context_updated', 'decision_made', 'system_message', 'state_changed',
  'briefing_started', 'briefing_field_collected', 'briefing_field_updated', 'briefing_field_ambiguous',
  'briefing_question_created', 'briefing_question_answered', 'briefing_confirmation_requested',
  'briefing_confirmed', 'briefing_cancelled', 'briefing_suspended', 'briefing_resumed',
  'command_prepared', 'command_superseded'
));
