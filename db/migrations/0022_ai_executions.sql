-- ai_executions — Sprint 08 (Fase 15). Telemetria/auditoria de chamadas ao AI Gateway. Nunca
-- guarda prompt ou resposta completos por padrão (ver comentário em ai-execution-repository.port.ts).
create table ai_executions (
  id                  text primary key,
  tenant_id           text not null,
  workspace_id        text not null references workspaces (id) on delete cascade,
  user_id             text,
  conversation_id     text references conversations (id) on delete set null,
  briefing_id         text references briefings (id) on delete set null,
  operation           text not null,
  provider            text not null,
  model               text not null,
  prompt_template_id  text not null,
  prompt_version      int not null,
  prompt_hash         text not null,
  status              text not null,
  input_token_count   int not null default 0,
  output_token_count  int not null default 0,
  total_token_count   int not null default 0,
  estimated_cost      double precision not null default 0,
  currency            text not null default 'USD',
  latency_ms          int not null,
  retry_count         int not null default 0,
  fallback_used       boolean not null default false,
  finish_reason       text,
  error_category      text,
  trace_id            text not null,
  correlation_id      text not null,
  created_at          timestamptz not null,
  completed_at        timestamptz,

  constraint ai_executions_status_check check (status in ('succeeded', 'failed')),
  constraint ai_executions_currency_check check (currency = 'USD')
);

-- Consulta principal: uso de IA por workspace num período (GetAiUsageSummary — Fase 33, rota adiada).
create index ai_executions_tenant_workspace_created_idx on ai_executions (tenant_id, workspace_id, created_at desc);

-- Consulta secundária: todas as execuções de IA de uma conversa (auditoria/depuração).
create index ai_executions_conversation_id_idx on ai_executions (conversation_id) where conversation_id is not null;
