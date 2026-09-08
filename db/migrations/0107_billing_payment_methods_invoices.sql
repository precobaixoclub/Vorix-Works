-- 0107 — SaaS Commercialization, Fase 1: caches de exibição de método de pagamento e fatura.
-- Nunca guardam dado de cartão real (PCI) — só marca/final/validade; o provedor de pagamento é a
-- fonte de verdade, sincronizado via webhook/API.

create table if not exists payment_methods (
  id                          text primary key,
  tenant_id                   text not null,
  provider                    text not null,
  provider_payment_method_id  text not null,
  brand                       text,
  last4                       text,
  exp_month                   integer,
  exp_year                    integer,
  is_default                  boolean not null default false,
  created_at                  timestamptz not null default now(),
  unique (provider, provider_payment_method_id)
);

create index if not exists payment_methods_tenant_idx on payment_methods (tenant_id);

create table if not exists invoices (
  id                  text primary key,
  tenant_id           text not null,
  subscription_id     text references subscriptions (id) on delete set null,
  provider            text not null,
  provider_invoice_id text not null,
  amount_cents        bigint not null,
  currency            text not null default 'USD',
  status              text not null check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')),
  period_start        timestamptz,
  period_end          timestamptz,
  pdf_url             text,
  created_at          timestamptz not null default now(),
  unique (provider, provider_invoice_id)
);

create index if not exists invoices_tenant_idx on invoices (tenant_id, created_at desc);
