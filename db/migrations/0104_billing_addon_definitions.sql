-- 0104 — SaaS Commercialization, Fase 1: catálogo de add-ons. Cada addon incrementa UM recurso
-- do vocabulário fechado de `plan-entitlements.model.ts` — nunca uma capability nova (add-on
-- expande quantidade, nunca desbloqueia uma funcionalidade que o plano base não tem).

create table if not exists addon_definitions (
  code              text primary key,
  name              text not null,
  description       text not null,
  monthly_price_usd numeric(10, 2) not null default 0,
  yearly_price_usd  numeric(10, 2) not null default 0,
  resource          text not null check (resource in ('users', 'workspaces', 'messaging_connections', 'contacts', 'ai_credits', 'storage_mb', 'automations')),
  increment         integer not null default 1,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

insert into addon_definitions (code, name, description, monthly_price_usd, yearly_price_usd, resource, increment) values
  ('extra_user', '+1 usuário', 'Adiciona 1 usuário além do limite do plano.', 15, 150, 'users', 1),
  ('extra_whatsapp_connection', '+1 conexão de WhatsApp', 'Adiciona 1 número de WhatsApp conectado além do limite do plano.', 39, 390, 'messaging_connections', 1),
  ('extra_workspace', '+1 workspace', 'Adiciona 1 workspace além do limite do plano.', 19, 190, 'workspaces', 1),
  ('extra_ai_credits_1000', '+1.000 créditos de IA', 'Adiciona 1.000 créditos de IA ao mês.', 25, 250, 'ai_credits', 1000),
  ('extra_contacts_5000', '+5.000 contatos', 'Adiciona 5.000 contatos ao limite do CRM.', 12, 120, 'contacts', 5000),
  ('extra_storage_5000mb', '+5 GB de armazenamento', 'Adiciona 5.000 MB de armazenamento.', 9, 90, 'storage_mb', 5000)
on conflict (code) do nothing;
