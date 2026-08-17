-- 0058 — Primeiro adapter Postgres do módulo Quality Feedback (`src/application/quality-feedback/*`
-- já existia, mas só tinha adapters in-memory/local-json, nunca ligado à API/produção). Espelha
-- `QualityFeedbackRecord` (quality-feedback.types.ts) campo a campo. Usado pelo novo endpoint de
-- rejeição estruturada (`POST /v1/production/executions/:runId/reject`) para registrar o motivo da
-- rejeição de uma peça gerada, consumido depois por `getRecentRejectionSignalsForWorkspace`.

create table quality_feedback (
  id                              text primary key,
  execution_id                    text not null,
  client_id                       text not null,
  content_type                    text not null,
  format                          text not null,
  skills_used                     text[] not null default '{}',
  campaign_id                     text,
  overall_score                   int not null,
  rating_kind                     text not null,
  rating_value                    numeric not null,
  category_scores                 jsonb not null default '[]',
  categories_needing_improvement  text[] not null default '{}',
  comment                         text,
  submitted_by                    jsonb,
  submitted_at                    timestamptz not null,

  constraint quality_feedback_rating_kind_check check (rating_kind in ('stars', 'score'))
);

create index quality_feedback_client_submitted_idx on quality_feedback (client_id, submitted_at desc);
create index quality_feedback_execution_idx on quality_feedback (execution_id);
