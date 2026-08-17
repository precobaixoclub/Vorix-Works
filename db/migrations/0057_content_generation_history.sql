-- 0057 — Memória editorial: registra, por workspace, as peças que passaram no quality gate (Lucas,
-- ver `QualityGateExecutionTaskHandler`/real-skill-execution-handlers.ts), para que a próxima
-- geração evite repetir headline/CTA/conceito visual recentes (requisito de "memória editorial").
-- Só peças aprovadas entram aqui de propósito — nunca ensinamos o sistema a repetir algo que já foi
-- reprovado. Uma linha por execução (não por tentativa de regeneração).

create table content_generation_history (
  id                    text primary key,
  tenant_id             text not null,
  workspace_id          text not null references workspaces (id) on delete cascade,
  execution_run_id      text not null references execution_runs (id) on delete cascade,
  marketing_objective   text,
  headline              text,
  title                 text,
  caption               text,
  cta                   text,
  visual_concept        text,
  composition_summary   text,
  quality_score         int,
  review_status         text,
  created_at            timestamptz not null
);

create unique index content_generation_history_execution_run_uq on content_generation_history (execution_run_id);
create index content_generation_history_workspace_created_idx on content_generation_history (workspace_id, created_at desc);
