-- Sprint 08 — proveniência de IA em BriefingFieldValue. `ai_execution_id` referencia a telemetria
-- completa em `ai_executions` (nunca duplicada aqui); `rationale_code`/`evidence` ficam vinculados
-- ao candidato em si (metadado interpretativo, não telemetria bruta).
alter table briefing_field_values add column ai_execution_id text references ai_executions (id) on delete set null;
alter table briefing_field_values add column rationale_code text;
alter table briefing_field_values add column evidence text;

alter table briefing_field_values drop constraint briefing_field_values_source_check;
alter table briefing_field_values add constraint briefing_field_values_source_check check (source in (
  'user_message', 'conversation_memory', 'workspace', 'company_knowledge', 'asset_metadata', 'system_inference', 'ai_extraction'
));
