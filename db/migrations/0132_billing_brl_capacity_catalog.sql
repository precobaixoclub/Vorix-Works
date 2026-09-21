-- 0132 — Pricing/Capacity Etapa B: catálogo comercial aprovado (pacote + capacidade + adicionais
-- self-service, em BRL). Aditiva em tudo: nenhuma versão histórica é sobrescrita, nenhuma
-- assinatura existente muda de preço sozinha (continuam referenciando plan_versions v1/v2, USD).
--
-- Capacidade incluída também muda nesta versão (seção 5 do pedido aprovado): START 2 usuários/1
-- número, PRO 5/2, BUSINESS 10/5 — usa as colunas `limits.users`/`limits.messaging_connections` já
-- existentes (nenhum campo novo), nunca duplicando o vocabulário de `plan-entitlements.model.ts`.

-- Moeda por adicional: hoje só existe em `plan_versions` (currency), nunca em `addon_definitions`
-- nem `subscription_items` — sem isso, migrar addons pra BRL seria ambíguo (a coluna se chama
-- "_usd" mas passaria a valer em reais sem nenhum sinal). `unit_price_usd`/`monthly_price_usd`
-- continuam com esse nome (mudar o nome da coluna é uma migration maior, fora de escopo aqui) —
-- `currency` é a fonte de verdade real sobre a unidade do valor.
alter table addon_definitions add column if not exists currency text not null default 'USD';
alter table subscription_items add column if not exists currency text not null default 'USD';

-- Adicionais aprovados: usuário R$39/mês, número conectado R$79/mês (mesmos códigos já existentes,
-- reutilizados — nunca um segundo sistema de add-on). UPDATE em vez de nova linha porque
-- `addon_definitions` nunca foi versionado (ver `docs/vorix-pricing-capacity-audit.md`, seção 7.2)
-- — o preço HISTÓRICO de quem já comprou continua correto porque está congelado em
-- `subscription_items.unit_price_usd`/`currency` no momento da compra, nunca recalculado a partir
-- daqui. Isto só muda o preço de COMPRAS NOVAS.
update addon_definitions set monthly_price_usd = 39, yearly_price_usd = 390, currency = 'BRL' where code = 'extra_user';
update addon_definitions set monthly_price_usd = 79, yearly_price_usd = 790, currency = 'BRL' where code = 'extra_whatsapp_connection';

-- Nova versão (v3) de START/PRO/BUSINESS: BRL, capacidade e preços aprovados. `capabilities` e os
-- demais `limits` (contacts/ai_credits/storage_mb/automations) e `allowed_addon_codes` copiados
-- integralmente da versão anterior de cada plano — só preço, moeda, `users` e
-- `messaging_connections` mudam nesta rodada.
insert into plan_versions (id, plan_code, version, name, tagline, monthly_price_usd, yearly_price_usd, currency, capabilities, limits, allowed_addon_codes, trial_days, active)
select
  'planv-' || lower(plan_code) || '-' || (version + 1),
  plan_code,
  version + 1,
  name,
  tagline,
  case plan_code when 'START' then 149 when 'PRO' then 299 when 'BUSINESS' then 599 end,
  case plan_code when 'START' then 1490 when 'PRO' then 2990 when 'BUSINESS' then 5990 end,
  'BRL',
  capabilities,
  jsonb_set(
    jsonb_set(limits, '{users}', case plan_code when 'START' then '2' when 'PRO' then '5' when 'BUSINESS' then '10' end::jsonb),
    '{messaging_connections}', case plan_code when 'START' then '1' when 'PRO' then '2' when 'BUSINESS' then '5' end::jsonb
  ),
  allowed_addon_codes,
  7,
  true
from plan_versions
where plan_code in ('START', 'PRO', 'BUSINESS') and active
  and not exists (select 1 from plan_versions v3 where v3.plan_code = plan_versions.plan_code and v3.currency = 'BRL');

update plan_versions
set active = false
where plan_code in ('START', 'PRO', 'BUSINESS') and currency = 'USD' and active;

-- Redução de capacidade agendada pro fim do ciclo (seção 15/22-23 do pedido) — fila simples, sem
-- Stripe.SubscriptionSchedule (superfície nova nunca usada no projeto). Ver
-- `SubscriptionPendingChange` no domínio para o racional completo.
create table if not exists subscription_pending_changes (
  id                    text primary key,
  subscription_id       text not null references subscriptions (id) on delete cascade,
  tenant_id             text not null,
  addon_code            text not null references addon_definitions (code),
  subscription_item_id  text references subscription_items (id) on delete set null,
  from_quantity         integer not null,
  target_quantity       integer not null,
  effective_at          timestamptz not null,
  applied_at            timestamptz,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists subscription_pending_changes_due_idx on subscription_pending_changes (effective_at) where applied_at is null and cancelled_at is null;
create index if not exists subscription_pending_changes_tenant_idx on subscription_pending_changes (tenant_id) where applied_at is null and cancelled_at is null;

-- Seção 7-8 do pedido: nunca duas linhas do mesmo addon na mesma assinatura, mesmo sob concorrência
-- real (duplo clique/retry). Sem assinantes reais ainda (Stripe nunca configurado em produção até
-- agora — ver auditoria), então não existe linha duplicada legada pra reconciliar antes do
-- constraint; documentado aqui como pré-condição, não como um passo de limpeza necessário hoje.
alter table subscription_items add constraint subscription_items_subscription_addon_uidx unique (subscription_id, addon_code);
