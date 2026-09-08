-- 0105 — SaaS Commercialization, Fase 1: assinatura de verdade, versionada e rastreável até o
-- provedor de pagamento. `tenant_billing` (já existente, Sprint 25) continua sendo a leitura
-- rápida usada em todo request path — esta tabela é a fonte de verdade do contrato comercial,
-- recalculada em `tenant_billing` a cada mudança (nunca o contrário). O índice único parcial
-- garante no máximo UMA assinatura não-terminal por tenant, mesmo sob concorrência real.

create table if not exists subscriptions (
  id                        text primary key,
  tenant_id                 text not null,
  plan_version_id           text not null references plan_versions (id),
  status                    text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'expired', 'suspended')),
  billing_provider          text not null default 'sandbox',
  provider_customer_id      text,
  provider_subscription_id  text,
  billing_interval          text not null default 'monthly' check (billing_interval in ('monthly', 'yearly')),
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean not null default false,
  canceled_at               timestamptz,
  cancellation_reason       text,
  trial_start               timestamptz,
  trial_end                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create unique index if not exists subscriptions_tenant_active_uidx on subscriptions (tenant_id) where status not in ('cancelled', 'expired');
create index if not exists subscriptions_provider_sub_idx on subscriptions (provider_subscription_id) where provider_subscription_id is not null;
create index if not exists subscriptions_tenant_idx on subscriptions (tenant_id);

create table if not exists subscription_items (
  id               text primary key,
  subscription_id  text not null references subscriptions (id) on delete cascade,
  addon_code       text not null references addon_definitions (code),
  quantity         integer not null default 1,
  unit_price_usd   numeric(10, 2) not null default 0,
  provider_item_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists subscription_items_subscription_idx on subscription_items (subscription_id);
