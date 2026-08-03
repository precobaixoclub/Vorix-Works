-- Sprint 25 (Fase 1) — Platform Admin + Billing por Tenant.
-- Duas responsabilidades novas:
--   1. Papel de "platform admin" (superadmin cross-tenant) — coluna em users, não uma tabela nova.
--   2. Billing por tenant: plano contratado, cotas mensais, créditos avulsos, ledger auditável de
--      créditos, e consumo mensal agregado com custo real (provider) vs. preço cobrado do cliente
--      (markup B2C). tenant_id continua sendo referência solta (mesma convenção de
--      workspaces.tenant_id, tenant_members.tenant_id) — tabela `tenants` não existe.

-- 1) Superadmin de plataforma — flag por usuário.
alter table users add column is_platform_admin boolean not null default false;

-- 2a) Billing por tenant — 1 linha por tenant. Cotas expressas em tokens Anthropic (unidade
-- comum de "IA"). price_multiplier é o markup B2C aplicado sobre o custo real do provider
-- (ex.: 2.00 = cobramos 2x o que pagamos).
create table tenant_billing (
  tenant_id                     text        primary key,
  plan_code                     text        not null default 'FREE',
  subscription_status           text        not null default 'trial',
  monthly_token_quota           bigint      not null default 100000,
  monthly_publications_quota    integer     not null default 5,
  credits_extra_tokens          bigint      not null default 0,
  price_multiplier              numeric(4,2) not null default 2.00,
  activated_at                  timestamptz,
  suspended_at                  timestamptz,
  expires_at                    timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint tenant_billing_plan_check
    check (plan_code in ('FREE','START','PRO','BUSINESS','ENTERPRISE')),
  constraint tenant_billing_status_check
    check (subscription_status in ('trial','active','past_due','cancelled','expired','suspended')),
  constraint tenant_billing_multiplier_check
    check (price_multiplier >= 1.00 and price_multiplier <= 100.00)
);

-- 2b) Ledger de créditos — audit trail de todo delta em credits_extra_tokens. Toda
-- movimentação (compra, uso, estorno, ajuste manual pelo admin) deixa uma linha aqui.
-- delta_tokens: positivo = adicionado; negativo = consumido/estornado.
create table tenant_credit_ledger (
  id             text        primary key,
  tenant_id      text        not null,
  delta_tokens   bigint      not null,
  reason         text        not null,
  actor_user_id  text        references users(id) on delete set null,
  metadata       jsonb       not null default '{}'::jsonb,
  occurred_at    timestamptz not null default now(),

  constraint tenant_credit_ledger_reason_check
    check (reason in (
      'manual_adjustment','plan_purchase','extra_purchase','ai_consumption',
      'refund','plan_reset','trial_grant','signup_grant'
    ))
);

create index tenant_credit_ledger_tenant_idx
  on tenant_credit_ledger (tenant_id, occurred_at desc);

-- 2c) Consumo mensal agregado por tenant — 1 linha por (tenant, período YYYY-MM).
-- provider_cost_usd  = quanto pagamos ao provedor real (Anthropic)
-- customer_price_usd = quanto cobramos do cliente (provider_cost * price_multiplier)
-- profit_usd = customer_price - provider_cost (materializado para facilitar consulta admin).
create table tenant_ai_usage_monthly (
  tenant_id            text          not null,
  period               text          not null,
  input_tokens         bigint        not null default 0,
  output_tokens        bigint        not null default 0,
  cached_input_tokens  bigint        not null default 0,
  provider_cost_usd    numeric(14,6) not null default 0,
  customer_price_usd   numeric(14,6) not null default 0,
  requests_count       integer       not null default 0,
  updated_at           timestamptz   not null default now(),

  primary key (tenant_id, period)
);

create index tenant_ai_usage_period_idx
  on tenant_ai_usage_monthly (period);

-- 3) Backfill de billing para tenants já existentes — descobre tenants ativos a partir de
-- tenant_members + workspaces (as duas fontes conhecidas de tenant_id). Todos entram como FREE
-- + trial + cota padrão (100k tokens/mês), preservando compatibilidade com a Sprint anterior:
-- ninguém tinha billing antes; agora todo mundo tem, e ninguém foi cobrado por consumo passado.
insert into tenant_billing (tenant_id)
select distinct tenant_id from tenant_members
union
select distinct tenant_id from workspaces
on conflict (tenant_id) do nothing;
