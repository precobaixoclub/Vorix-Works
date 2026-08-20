-- 0060 — Prova auditável de qual motor criativo produziu cada peça (migração "GPT como motor
-- criativo único", PR 1/9 — persistência antes de qualquer wiring). Uma linha por execução do
-- motor criativo (GPT hoje; motor legado registra aqui também quando ativo, para permitir
-- comparação/rollback). Guarda o `creative_context`/`creative_plan`/prompt final de imagem
-- INTEGRALMENTE — diferente da política de `ai_executions` (0022, "nunca guarda prompt/resposta
-- completos"), porque é exatamente essa prova ponta-a-ponta que a auditoria anterior não
-- conseguiu fazer (nenhum artefato local/persistido comprovava se uma geração passou pelo
-- protótipo GPT ou pelo motor antigo). Nunca exposto em resposta de API voltada a tenant — só
-- painel administrativo/debug. Nunca contém credenciais.
--
-- `publishable` nasce `false` de propósito: uma inserção que falhar antes do fim nunca pode
-- parecer aprovada por omissão.

create table creative_engine_runs (
  id                   text primary key,
  tenant_id            text not null,
  workspace_id         text not null references workspaces (id) on delete cascade,
  execution_run_id     text not null references execution_runs (id) on delete cascade,
  task_run_id          text,
  engine_mode          text not null,
  planning_template    text not null,
  director_model       text not null,
  image_model          text,
  generation_method    text,
  creative_context     jsonb not null,
  creative_plan        jsonb,
  final_image_prompt   text,
  assets_used          jsonb not null default '[]'::jsonb,
  composition_steps    jsonb not null default '[]'::jsonb,
  quality_gate         jsonb,
  repair_rounds        jsonb not null default '[]'::jsonb,
  final_image_url      text,
  final_image_width    int,
  final_image_height   int,
  publishable          boolean not null default false,
  estimated_cost_usd   numeric(12, 6) not null default 0,
  latency_ms           int not null default 0,
  status               text not null,
  error_code           text,
  created_at           timestamptz not null,

  constraint creative_engine_runs_engine_mode_check check (engine_mode in ('gpt', 'legacy')),
  constraint creative_engine_runs_generation_method_check check (
    generation_method is null or generation_method in ('generation', 'edit', 'original_asset_composition')
  ),
  constraint creative_engine_runs_status_check check (status in ('completed', 'failed'))
);

create unique index creative_engine_runs_execution_run_uq on creative_engine_runs (execution_run_id);
create index creative_engine_runs_workspace_created_idx on creative_engine_runs (workspace_id, created_at desc);
create index creative_engine_runs_engine_mode_idx on creative_engine_runs (engine_mode, created_at desc);
