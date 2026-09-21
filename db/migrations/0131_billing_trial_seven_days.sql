-- 0131 — Aquisição self-service: trial padrão passa de 14 para 7 dias nos planos pagos (seção 2 do
-- pedido: "Adotar inicialmente: 7 DIAS DE TESTE... deve ficar configurável no backend/catalog...
-- não espalhar 7 hardcoded em várias telas"). `trial_days` já é uma coluna configurável por
-- `plan_version` (não precisa de schema novo) — mas mudar o valor da versão 1 em UPDATE quebraria
-- o próprio princípio de imutabilidade documentado em `platform-plan-catalog.ts`/
-- `docs/saas-commercialization-audit.md` §2.3 ("mudar o catálogo em código nunca sobrescreve uma
-- versão já contratada"). Gera versão 2 de START/PRO/BUSINESS, idêntica em tudo à versão 1 exceto
-- `trial_days`, e desativa a versão 1 — o mesmo efeito que o endpoint admin de "nova versão"
-- (`admin-plan-versions.route.ts`) produziria, só que via migration porque nenhuma assinatura real
-- ainda referencia essas versões em produção (Stripe não está configurado; nenhum checkout real
-- aconteceu — ver auditoria). FREE/ENTERPRISE não têm trial (`trial_days` null) e ficam de fora.

insert into plan_versions (id, plan_code, version, name, tagline, monthly_price_usd, yearly_price_usd, currency, capabilities, limits, allowed_addon_codes, trial_days, active)
select
  'planv-' || lower(plan_code) || '-' || (version + 1),
  plan_code,
  version + 1,
  name,
  tagline,
  monthly_price_usd,
  yearly_price_usd,
  currency,
  capabilities,
  limits,
  allowed_addon_codes,
  7,
  true
from plan_versions
where plan_code in ('START', 'PRO', 'BUSINESS') and active
  and not exists (
    select 1 from plan_versions v2 where v2.plan_code = plan_versions.plan_code and v2.trial_days = 7
  );

update plan_versions
set active = false
where plan_code in ('START', 'PRO', 'BUSINESS') and trial_days = 14 and active;
