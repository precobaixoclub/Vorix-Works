-- 0103 — SaaS Commercialization, Fase 1: versionamento imutável de plano. Mudar o catálogo em
-- código nunca sobrescreve uma versão já contratada — sempre gera uma linha nova com `version`
-- incrementado (ver `docs/saas-commercialization-audit.md`, seção 2.3). `capabilities`/`limits`
-- guardam o vocabulário fechado de `plan-entitlements.model.ts` como JSON (chave = nome da
-- capability/recurso, nunca um nome comercial de plano).

create table if not exists plan_versions (
  id                  text primary key,
  plan_code           text not null check (plan_code in ('FREE', 'START', 'PRO', 'BUSINESS', 'ENTERPRISE')),
  version             integer not null,
  name                text not null,
  tagline             text not null,
  monthly_price_usd   numeric(10, 2) not null default 0,
  yearly_price_usd    numeric(10, 2) not null default 0,
  currency            text not null default 'USD',
  capabilities        jsonb not null default '{}',
  limits              jsonb not null default '{}',
  allowed_addon_codes jsonb not null default '[]',
  trial_days          integer,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (plan_code, version)
);

create index if not exists plan_versions_plan_code_idx on plan_versions (plan_code, version desc);
create index if not exists plan_versions_active_idx on plan_versions (plan_code) where active;

-- Versão 1 dos 5 planos existentes hoje (`platform-plan-catalog.ts`) — valores iniciais de
-- capabilities/limites, ajustáveis depois via admin (nova versão), nunca hardcoded em código
-- daqui pra frente. Preço/cota espelham o catálogo TS atual; capabilities/limites novos (users,
-- messaging_connections, contacts, storage, automations) são um primeiro corte razoável, não
-- uma medição real de uso — documentado como tal.
insert into plan_versions (id, plan_code, version, name, tagline, monthly_price_usd, yearly_price_usd, currency, capabilities, limits, allowed_addon_codes, trial_days, active) values
  ('planv-free-1', 'FREE', 1, 'Gratuito', 'Para conhecer o Vorix', 0, 0, 'USD',
   '{"crm":true,"conversations":true,"marketing":true,"proposals":false,"automation":false,"ai_auto_reply":false,"advanced_analytics":false}',
   '{"users":1,"workspaces":1,"messaging_connections":1,"contacts":200,"ai_credits":50,"storage_mb":100,"automations":0}',
   '[]', null, true),
  ('planv-start-1', 'START', 1, 'Start', 'Para consultores e influenciadores', 29, 290, 'USD',
   '{"crm":true,"conversations":true,"marketing":true,"proposals":true,"automation":false,"ai_auto_reply":true,"advanced_analytics":false}',
   '{"users":3,"workspaces":null,"messaging_connections":1,"contacts":2000,"ai_credits":500,"storage_mb":1000,"automations":3}',
   '["extra_user","extra_whatsapp_connection","extra_ai_credits_1000","extra_contacts_5000","extra_storage_5000mb"]', 14, true),
  ('planv-pro-1', 'PRO', 1, 'Pro', 'Para agências em operação', 89, 890, 'USD',
   '{"crm":true,"conversations":true,"marketing":true,"proposals":true,"automation":true,"ai_auto_reply":true,"advanced_analytics":true}',
   '{"users":8,"workspaces":null,"messaging_connections":3,"contacts":10000,"ai_credits":2500,"storage_mb":5000,"automations":15}',
   '["extra_user","extra_whatsapp_connection","extra_workspace","extra_ai_credits_1000","extra_contacts_5000","extra_storage_5000mb"]', 14, true),
  ('planv-business-1', 'BUSINESS', 1, 'Business', 'Para operações multi-marca', 249, 2490, 'USD',
   '{"crm":true,"conversations":true,"marketing":true,"proposals":true,"automation":true,"ai_auto_reply":true,"advanced_analytics":true}',
   '{"users":25,"workspaces":null,"messaging_connections":10,"contacts":50000,"ai_credits":10000,"storage_mb":20000,"automations":50}',
   '["extra_user","extra_whatsapp_connection","extra_workspace","extra_ai_credits_1000","extra_contacts_5000","extra_storage_5000mb"]', 14, true),
  ('planv-enterprise-1', 'ENTERPRISE', 1, 'Enterprise', 'Volume corporativo', 0, 0, 'USD',
   '{"crm":true,"conversations":true,"marketing":true,"proposals":true,"automation":true,"ai_auto_reply":true,"advanced_analytics":true}',
   '{"users":null,"workspaces":null,"messaging_connections":null,"contacts":null,"ai_credits":null,"storage_mb":null,"automations":null}',
   '[]', null, true)
on conflict (plan_code, version) do nothing;
