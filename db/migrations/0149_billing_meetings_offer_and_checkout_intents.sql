-- 0149 — Contratação automática: oferta oficial do Vorix Meetings no catálogo de billing e o
-- PEDIDO de checkout (o que a pessoa configurou) guardado do nosso lado.
--
-- Aditiva e idempotente. Nenhum preço já cobrado é reescrito.
--
-- Meetings é vendido por GRAVAÇÃO SIMULTÂNEA (nunca por conta de gravação/bot):
--   meetings_base             R$ 147/mês  → 1 gravação simultânea
--   meetings_extra_recording  R$  67/mês  → +1 gravação simultânea (análise de mercado: abaixo do
--                                           preço por usuário de Fireflies/tl;dv/Otter/Fathom)
-- A contratação de Meetings continua bloqueada pelo gate comercial até a gravação funcionar em
-- produção; o catálogo existe para preço transparente e para a liberação ser um único passo.

alter table addon_definitions drop constraint if exists addon_definitions_resource_check;
alter table addon_definitions add constraint addon_definitions_resource_check check (resource in
  ('users', 'workspaces', 'messaging_connections', 'contacts', 'ai_credits', 'storage_mb', 'automations', 'meetings_concurrent_recordings')) not valid;
alter table addon_definitions validate constraint addon_definitions_resource_check;

insert into addon_definitions (code, name, description, monthly_price_usd, yearly_price_usd, currency, resource, increment, active) values
  ('meetings_base', 'Vorix Meetings', 'Vorix Meetings com 1 gravação simultânea.', 147, 1470, 'BRL', 'meetings_concurrent_recordings', 1, true),
  ('meetings_extra_recording', '+1 gravação simultânea', 'Adiciona 1 gravação simultânea ao Vorix Meetings.', 67, 670, 'BRL', 'meetings_concurrent_recordings', 1, true)
on conflict (code) do nothing;

-- Os planos pagos ativos aceitam os adicionais do Meetings (Suite = plano de Conversas + Meetings).
update plan_versions
   set allowed_addon_codes = allowed_addon_codes || '["meetings_base","meetings_extra_recording"]'::jsonb
 where active and plan_code in ('START', 'PRO', 'BUSINESS')
   and not (allowed_addon_codes ? 'meetings_base');

-- Pedido de checkout: plano + adicionais com quantidade e preço congelado no momento do pedido.
-- O webhook confirmado aplica exatamente isto — nunca o que o navegador reportar depois.
create table if not exists billing_checkout_intents (
  id                   text primary key,
  tenant_id            text not null,
  plan_version_id      text not null references plan_versions (id),
  billing_interval     text not null check (billing_interval in ('monthly', 'yearly')),
  items                jsonb not null default '[]'::jsonb,
  amount               numeric(12, 2) not null,
  currency             text not null,
  provider             text not null,
  provider_session_id  text,
  status               text not null default 'pending' check (status in ('pending', 'completed', 'superseded')),
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);
create index if not exists billing_checkout_intents_tenant_idx on billing_checkout_intents (tenant_id, created_at desc);
create index if not exists billing_checkout_intents_session_idx on billing_checkout_intents (provider_session_id) where provider_session_id is not null;
