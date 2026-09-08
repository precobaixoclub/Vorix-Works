-- 0108 — SaaS Commercialization, Fase 1: auditoria de negócio (`billing_events`) e log bruto +
-- dedup do evento recebido do provedor de pagamento (`payment_webhook_events`) — mesmo padrão
-- comprovado de `inbox_messages` (`unique(provider, provider_event_id)` +
-- `insert ... on conflict do nothing`), nunca o middleware de idempotência HTTP existente.

create table if not exists billing_events (
  id              text primary key,
  tenant_id       text not null,
  subscription_id text references subscriptions (id) on delete set null,
  event_type      text not null check (event_type in (
    'subscription_created', 'subscription_updated', 'subscription_canceled', 'subscription_resumed',
    'trial_started', 'trial_converted', 'trial_expired',
    'payment_succeeded', 'payment_failed', 'addon_purchased', 'addon_removed'
  )),
  payload         jsonb not null default '{}',
  occurred_at     timestamptz not null default now()
);

create index if not exists billing_events_tenant_idx on billing_events (tenant_id, occurred_at desc);

create table if not exists payment_webhook_events (
  id                 text primary key,
  provider           text not null,
  provider_event_id  text not null,
  event_type         text not null,
  payload            jsonb not null,
  processed          boolean not null default false,
  processed_at       timestamptz,
  error              text,
  received_at        timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists payment_webhook_events_provider_idx on payment_webhook_events (provider, received_at desc);
create index if not exists payment_webhook_events_unprocessed_idx on payment_webhook_events (received_at) where not processed;
