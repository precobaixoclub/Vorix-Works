-- 0061 — Colunas aditivas de proveniência do motor criativo (PR 1/9 da migração "GPT como motor
-- criativo único"). Puramente aditivo: linhas históricas continuam legíveis, `engine_mode is null`
-- lê-se honestamente como "execução anterior a esta coluna existir" — nenhuma migração destrutiva
-- nesta etapa (só depois do novo motor validado em produção, ver plano de rollout).

alter table content_generation_history add column if not exists engine_mode text;
alter table content_generation_history add column if not exists creative_engine_run_id text references creative_engine_runs (id) on delete set null;
alter table content_generation_history add column if not exists description text;

create index if not exists content_generation_history_creative_engine_run_idx on content_generation_history (creative_engine_run_id);

alter table execution_runs add column if not exists creative_engine text;
alter table execution_task_runs add column if not exists creative_engine text;
