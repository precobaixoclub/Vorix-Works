-- BriefingQuestion — Sprint 07 (Fase 11). Antes de briefing_field_values porque field_values
-- pode referenciar a pergunta que originou a resposta (question_id).
create table briefing_questions (
  id            text primary key,
  briefing_id   text not null references briefings (id) on delete cascade,
  field_keys    text[] not null,
  text          text not null,
  reason        text not null,
  priority      int not null,
  answer_type   text not null,
  options       text[],
  status        text not null,
  created_at    timestamptz not null,
  answered_at   timestamptz,
  superseded_at timestamptz,

  constraint briefing_questions_answer_type_check check (answer_type in ('text', 'single_choice', 'multi_choice', 'date', 'confirmation')),
  constraint briefing_questions_status_check check (status in ('pending', 'answered', 'superseded'))
);

-- Consulta principal: a pergunta pendente de um Briefing (deve haver no máximo uma por vez).
create index briefing_questions_briefing_id_idx on briefing_questions (briefing_id);

-- Invariante: no máximo uma pergunta PENDING por Briefing — "nunca criar múltiplas perguntas
-- concorrentes sem necessidade" (Sprint 07B, Fase 6).
create unique index briefing_questions_one_pending_per_briefing
  on briefing_questions (briefing_id)
  where status = 'pending';
