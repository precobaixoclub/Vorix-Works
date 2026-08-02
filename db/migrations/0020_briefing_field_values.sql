-- BriefingFieldValue — Sprint 07 (Fase 3/11). Histórico APPEND-ONLY — nunca UPDATE numa linha
-- existente. Seleção do "valor atual" é sempre `revision desc, created_at desc, id desc`
-- (`selectCurrentFieldValues`, src/application/briefing/field-state.ts) — nunca timestamp sozinho.
create table briefing_field_values (
  id                    text primary key,
  briefing_id           text not null references briefings (id) on delete cascade,
  field_key             text not null,
  value                 text not null,
  normalized_value      text not null,
  source                text not null,
  confidence            double precision not null,
  question_id           text references briefing_questions (id) on delete set null,
  conversation_event_id text references conversation_events (id) on delete set null,
  asset_id              text references assets (id) on delete set null,
  confirmed_by_user      boolean not null default false,
  revision              int not null,
  supersedes_value_id   text references briefing_field_values (id),
  ambiguity_status      text not null,
  created_at            timestamptz not null,

  constraint briefing_field_values_source_check check (source in (
    'user_message', 'conversation_memory', 'workspace', 'company_knowledge', 'asset_metadata', 'system_inference'
  )),
  constraint briefing_field_values_confidence_range check (confidence >= 0 and confidence <= 1),
  constraint briefing_field_values_revision_positive check (revision >= 1),
  constraint briefing_field_values_ambiguity_status_check check (ambiguity_status in ('none', 'ambiguous', 'resolved'))
);

-- Consulta principal: todo o histórico de um Briefing, na ordem determinística de "valor atual".
create index briefing_field_values_briefing_id_idx on briefing_field_values (briefing_id, field_key, revision desc, created_at desc, id desc);

-- Defesa de concorrência: duas respostas simultâneas para o MESMO campo nunca produzem a mesma
-- revisão — a segunda perde a corrida no banco (unique_violation) e o caso de uso reconsulta o
-- máximo atual e tenta de novo (mesmo padrão de "recheck after conflict" do migration-runner).
create unique index briefing_field_values_briefing_field_revision_uq on briefing_field_values (briefing_id, field_key, revision);
