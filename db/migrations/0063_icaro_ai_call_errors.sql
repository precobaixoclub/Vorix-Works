-- 0063 — Mensagens de erro reais das chamadas de IA via Ícaro (PR 1/9 da migração "GPT como motor
-- criativo único"). Complementa `icaro_ai_calls` (0062), que só guarda status/custo/latência
-- agregados por chamada completa, nunca o motivo de uma falha. Só as duas ações de log que
-- carregam diagnóstico útil (`Timeout`, `Error`, ver `IcaroLogAction` em `icaro-log.contract.ts`)
-- geram linha aqui — as demais (`AIRequestReceived`, `ProviderSelected`, `ModelSelected`,
-- `AICallStarted`, `RetryScheduled`, `FallbackStarted`, `ResponseDelivered`) não, para não
-- multiplicar ~10 linhas por chamada sem valor de auditoria adicional além do que
-- `icaro_ai_calls`/eventos já cobrem.

create table icaro_ai_call_errors (
  id                text primary key,
  occurred_at       timestamptz not null,
  brain             text not null,
  action            text not null,
  message           text not null,
  specialist_id     text,
  execution_run_id  text,
  task_id           text,
  provider_id       text,
  model_id          text,
  attempt           int,

  constraint icaro_ai_call_errors_brain_check check (brain in ('creative', 'legacy')),
  constraint icaro_ai_call_errors_action_check check (action in ('Timeout', 'Error'))
);

create index icaro_ai_call_errors_execution_idx on icaro_ai_call_errors (execution_run_id, occurred_at desc);
