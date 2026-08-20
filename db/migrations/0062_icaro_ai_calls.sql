-- 0062 — Persistência real das chamadas de IA feitas via Ícaro (`IcaroAIBrain`/`IcaroBrainPort`).
-- Antes desta migração, TODA chamada de IA das Skills (João/Maria/Bianca/Pedro/Lucas/Sofia, e a
-- partir da migração "GPT como motor criativo único", também o motor GPT) era invisível em
-- qualquer armazenamento durável — `IcaroLoggerPort`/`IcaroCostLedgerPort` só tinham
-- implementação em memória, perdida a cada reinício do processo. Uma linha por chamada completa a
-- `IcaroAIBrain.request()` (sucesso ou falha), escrita pelo `IcaroCostLedgerPort.record()`, que já
-- roda exatamente uma vez por chamada em ambos os caminhos.
--
-- Segue a mesma política de `ai_executions` (0022): nunca guarda prompt ou resposta completos,
-- só metadados operacionais + hash do prompt.

create table icaro_ai_calls (
  id                     text primary key,
  occurred_at            timestamptz not null,
  brain                  text not null,
  specialist_id          text not null,
  task_type              text not null,
  provider_id            text,
  model_id               text,
  execution_run_id       text,
  task_id                text,
  correlation_id         text,
  creative_engine_run_id text,
  status                 text not null,
  duration_ms            int not null default 0,
  input_tokens           int not null default 0,
  output_tokens          int not null default 0,
  total_tokens           int not null default 0,
  estimated_cost         numeric(12, 6) not null default 0,
  currency               text not null default 'USD',
  retry_count            int not null default 0,
  fallback_used          boolean not null default false,
  prompt_hash            text,
  prompt_chars           int,

  constraint icaro_ai_calls_brain_check check (brain in ('creative', 'legacy')),
  constraint icaro_ai_calls_status_check check (status in ('completed', 'failed'))
);

create index icaro_ai_calls_execution_idx on icaro_ai_calls (execution_run_id, occurred_at desc);
create index icaro_ai_calls_creative_run_idx on icaro_ai_calls (creative_engine_run_id);
create index icaro_ai_calls_specialist_idx on icaro_ai_calls (specialist_id, occurred_at desc);
