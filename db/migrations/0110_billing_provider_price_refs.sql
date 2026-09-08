-- 0110 — SaaS Commercialization, Fase 2 (Checkout): referência ao Price do gateway de pagamento
-- real por (plano, intervalo) e por (add-on, intervalo). `SandboxBillingProvider` ignora estas
-- colunas por completo (nunca valida `providerPlanPriceRef`); ficam nulas até um administrador
-- criar os Products/Prices correspondentes no Stripe e preenchê-las via
-- `POST /admin/plan-versions` — nenhum código de domínio depende delas existirem.

alter table plan_versions add column if not exists monthly_provider_price_ref text;
alter table plan_versions add column if not exists yearly_provider_price_ref text;

alter table addon_definitions add column if not exists monthly_provider_price_ref text;
alter table addon_definitions add column if not exists yearly_provider_price_ref text;
