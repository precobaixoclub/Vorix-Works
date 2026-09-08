-- 0113 — Product Analytics: fundação de eventos de produto. Deliberadamente separada de
-- `analytics_events` (pipeline de conteúdo/publicação), `auth_audit_log` (segurança/sessão) e
-- `billing_events` (mudança de estado de billing) — nenhuma dessas serve pro funil de produto
-- (visita → cadastro → trial → ativação → pago → retenção), e nenhuma delas é alterada aqui.

create table if not exists product_events (
  id             text primary key,
  event_name     text not null,
  occurred_at    timestamptz not null,
  received_at    timestamptz not null default now(),
  anonymous_id   text,
  user_id        text,
  tenant_id      text,
  workspace_id   text,
  session_id     text,
  source         text not null check (source in ('client', 'server')),
  properties     jsonb not null default '{}',
  schema_version integer not null default 1
);

-- Consultas do funil/growth dashboard: "todos os eventos X de um tenant/período" e "quando um
-- anônimo específico fez o quê" (associar depois do signup).
create index if not exists product_events_tenant_occurred_idx on product_events (tenant_id, occurred_at desc);
create index if not exists product_events_name_occurred_idx on product_events (event_name, occurred_at desc);
create index if not exists product_events_anonymous_idx on product_events (anonymous_id) where anonymous_id is not null;

-- Idempotência dos eventos "first_*" (seção 8) — a PRIMEIRA linha por (workspace, evento) vence;
-- `insert ... on conflict do nothing` decide se o `product_events` correspondente é gravado.
-- Tabela separada de propósito: nunca um índice único pesado na tabela de alto volume.
create table if not exists product_event_firsts (
  tenant_id    text not null,
  workspace_id text not null,
  event_name   text not null,
  occurred_at  timestamptz not null default now(),
  primary key (workspace_id, event_name)
);
