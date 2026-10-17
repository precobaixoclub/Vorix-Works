-- 0160 — Compra avulsa de créditos de IA (quantidade livre, cobrada na forma de pagamento salva ou
-- por checkout de pagamento único). O crédito só entra em `credits_extra` quando o pagamento é
-- confirmado — uma única vez por compra (`status` muda de pending para paid de forma atômica).

create table if not exists ai_credit_purchases (
  id text primary key,
  tenant_id text not null,
  credits integer not null check (credits > 0),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  provider text not null,
  method text not null check (method in ('saved_card', 'checkout')),
  provider_payment_id text,
  checkout_url text,
  failure_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists ai_credit_purchases_tenant_idx on ai_credit_purchases (tenant_id, created_at desc);
