-- 0143 — Radar de Sentimento / Radar Operacional (réplica adaptada do CMDesk, pedido explícito do
-- usuário) com controle comercial por créditos de IA. Só ADITIVA: nenhuma coluna/tabela existente
-- é alterada de forma incompatível, nenhum dado histórico é apagado.
--
-- Duas camadas, com custo deliberadamente separado:
--   Camada 1 (gratuita) — keywords + classificador léxico + sinais operacionais → score 0..100.
--     Roda por mensagem, nunca consome crédito.
--   Camada 2 (créditos) — diagnóstico profundo via LLM, cobrado pelo MESMO serviço central de
--     créditos das demais operações de IA (`ai_operation_types` / `ai_generation_ledger`,
--     `CreditAccountingService`). Nunca uma carteira paralela do Radar.

-- 1) Operação cobrável do Radar no catálogo central — sem esta linha
--    `CreditAccountingService.checkAvailability("sentiment_radar_analysis", ...)` devolve
--    `operation_unknown` e nenhuma análise profunda roda. O custo (1 crédito por análise) é
--    editável no painel admin como o de qualquer outra operação — nunca hardcoded no Radar.
insert into ai_operation_types (code, label, capability, credits_cost, default_provider_code, default_model_id)
values ('sentiment_radar_analysis', 'Radar de Sentimento — diagnóstico de risco da conversa', 'text_generation', 1, 'anthropic', 'claude-haiku-4-5-20251001')
on conflict (code) do nothing;

-- 2) Feature flag por equipe (mesmo desenho do `radar_enabled` do CMDesk). Default `true`: a
--    equipe participa do Radar assim que o workspace o tiver ligado (ver `radar_settings`).
alter table teams add column if not exists radar_enabled boolean not null default true;

-- 3) Configuração do Radar por workspace. Ausência de linha = defaults do sistema (Radar ligado,
--    IA ligada, limiar 60, cooldown 30 min, SLA 30 min) — nunca exige um seed por workspace.
create table if not exists radar_settings (
  workspace_id           text primary key references workspaces (id) on delete cascade,
  tenant_id              text not null,
  radar_enabled          boolean not null default true,
  ai_analysis_enabled    boolean not null default true,
  ai_trigger_threshold   integer not null default 60 check (ai_trigger_threshold between 1 and 100),
  ai_cooldown_minutes    integer not null default 30 check (ai_cooldown_minutes between 1 and 1440),
  sla_minutes            integer not null default 30 check (sla_minutes between 1 and 10080),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- 4) Keywords configuráveis por workspace e, opcionalmente, por equipe. As listas padrão vivem no
--    código (`domain/radar/radar-keywords.ts`); cada linha aqui é um AJUSTE sobre elas: adiciona
--    uma keyword nova, desabilita uma padrão (`enabled = false`), troca a categoria ou o peso.
--    `team_id` nulo = vale para o workspace inteiro; preenchido = só para aquela equipe (e vence
--    o ajuste do workspace para a mesma keyword).
create table if not exists radar_keywords (
  id            text primary key,
  tenant_id     text not null,
  workspace_id  text not null references workspaces (id) on delete cascade,
  team_id       text references teams (id) on delete cascade,
  -- Sempre normalizada (minúsculas, sem acento) — é a chave de matching.
  keyword       text not null,
  category      text not null check (category in ('cancellation', 'legal', 'manager', 'complaint')),
  -- Nulo = usa o peso padrão da categoria.
  weight        integer check (weight is null or weight between 0 and 100),
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists radar_keywords_scope_keyword_uidx
  on radar_keywords (workspace_id, coalesce(team_id, ''), keyword);
create index if not exists radar_keywords_tenant_workspace_idx on radar_keywords (tenant_id, workspace_id);

-- 5) Score de risco por conversa (uma linha por conversa). `ai_analysis`/`ai_analyzed_at` guardam
--    o ÚLTIMO diagnóstico bem-sucedido e nunca são zerados por uma tentativa bloqueada/falha —
--    nesses casos só `ai_status`/`ai_blocked_reason`/`ai_last_attempt_at` mudam.
create table if not exists conversation_risk_scores (
  id                         text primary key,
  tenant_id                  text not null,
  workspace_id               text not null references workspaces (id) on delete cascade,
  conversation_id            text not null unique references inbox_conversations (id) on delete cascade,
  team_id                    text,
  agent_id                   text,
  contact_id                 text,

  score                      integer not null default 0 check (score between 0 and 100),
  level                      text not null default 'low' check (level in ('low', 'medium', 'high', 'critical')),
  reasons                    jsonb not null default '[]'::jsonb,
  signals                    jsonb not null default '{}'::jsonb,

  has_keyword_trigger        boolean not null default false,
  has_cancellation           boolean not null default false,
  has_legal_threat           boolean not null default false,
  has_manager_request        boolean not null default false,
  has_complaint              boolean not null default false,
  has_urgency                boolean not null default false,

  waiting_minutes            integer not null default 0,
  message_count              integer not null default 0,
  inbound_count              integer not null default 0,
  transfer_count             integer not null default 0,
  reopen_count               integer not null default 0,

  conversation_context       text,
  -- Última mensagem avaliada pela Camada 1 — torna a reavaliação da MESMA mensagem (reentrega,
  -- ou reprocessamento após transcrição de áudio) reconhecível.
  last_evaluated_message_id  text,
  -- Quando o score/sinais mudaram pela última vez. Comparado com `ai_analyzed_at` para saber se o
  -- diagnóstico de IA está desatualizado.
  score_changed_at           timestamptz not null default now(),

  ai_analysis                jsonb,
  ai_analyzed_at             timestamptz,
  ai_analyzed_score          integer,
  ai_status                  text not null default 'NEVER_ANALYZED'
    check (ai_status in ('NEVER_ANALYZED', 'ANALYZED', 'PENDING', 'BLOCKED_NO_CREDITS', 'FAILED_PROVIDER', 'COOLDOWN')),
  ai_blocked_reason          text,
  ai_last_attempt_at         timestamptz,
  ai_credit_transaction_id   text,
  -- Claim atômico (CAS) da análise em andamento — só uma análise por conversa a qualquer momento.
  ai_pending_since           timestamptz,
  ai_trigger_id              text,
  -- Nenhuma nova análise automática/manual antes deste instante (cooldown após sucesso, backoff
  -- curto após falha de provider). Nulo = livre.
  ai_cooldown_until          timestamptz,

  is_dismissed               boolean not null default false,
  dismissed_at               timestamptz,
  dismissed_by               text,
  dismissed_note             text,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- Consulta principal da tela: alertas ativos do workspace, por score.
create index if not exists conversation_risk_scores_active_idx
  on conversation_risk_scores (tenant_id, workspace_id, score desc, updated_at desc)
  where is_dismissed = false and has_keyword_trigger = true and score > 0;
create index if not exists conversation_risk_scores_team_idx on conversation_risk_scores (tenant_id, workspace_id, team_id);
create index if not exists conversation_risk_scores_agent_idx on conversation_risk_scores (tenant_id, workspace_id, agent_id);

-- 6) Auditoria de cada tentativa de análise profunda (concluída, bloqueada por crédito ou falha
--    de provider). `idempotency_key` é a MESMA chave gravada em
--    `ai_generation_ledger.idempotency_key` quando há débito — é por ela que se chega à transação
--    de crédito correspondente.
create table if not exists radar_ai_analysis_logs (
  id                      text primary key,
  tenant_id               text not null,
  workspace_id            text not null references workspaces (id) on delete cascade,
  conversation_id         text not null,
  feature                 text not null default 'sentiment_radar',
  trigger_id              text not null,
  trigger_source          text not null check (trigger_source in ('auto', 'manual')),
  trigger_reason          text,
  idempotency_key         text not null,
  score                   integer not null,
  level                   text not null,
  status                  text not null check (status in ('completed', 'blocked_no_credits', 'failed_provider')),
  credit_transaction_id   text,
  credits_reserved        integer not null default 0,
  credits_consumed        integer not null default 0,
  provider                text,
  model                   text,
  input_tokens            integer,
  output_tokens           integer,
  estimated_cost_usd      numeric(12, 6),
  error_category          text,
  requested_by_user_id    text,
  created_at              timestamptz not null default now()
);

create index if not exists radar_ai_analysis_logs_conversation_idx on radar_ai_analysis_logs (conversation_id, created_at desc);
create index if not exists radar_ai_analysis_logs_tenant_idx on radar_ai_analysis_logs (tenant_id, workspace_id, created_at desc);
-- Um único registro "completed" por chave — segunda linha de defesa contra diagnóstico duplicado.
create unique index if not exists radar_ai_analysis_logs_completed_key_uidx
  on radar_ai_analysis_logs (idempotency_key)
  where status = 'completed';

-- 7) Histórico de arquivar/reativar alerta.
create table if not exists radar_dismissal_log (
  id               text primary key,
  tenant_id        text not null,
  workspace_id     text not null references workspaces (id) on delete cascade,
  conversation_id  text not null,
  action           text not null check (action in ('dismissed', 'reactivated')),
  user_id          text,
  note             text,
  created_at       timestamptz not null default now()
);

create index if not exists radar_dismissal_log_conversation_idx on radar_dismissal_log (conversation_id, created_at desc);
