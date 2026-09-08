-- 0112 — Trial + Product Analytics: novo status `trial_expired`, distinto de `expired`
-- (cancelamento definitivo) e de `suspended` (suspensão administrativa manual). Continua "ativo"
-- para `subscriptions_tenant_active_uidx`/`getActiveByTenant` (não está em `('cancelled',
-- 'expired')`) — nunca some da Subscription real, só entra no modo somente-leitura já existente.

alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check
  check (status in ('trial', 'active', 'past_due', 'cancelled', 'expired', 'suspended', 'trial_expired'));

-- Migration 0051 nomeou este constraint explicitamente como `tenant_billing_status_check`
-- (não o padrão `<tabela>_<coluna>_check`) — nome confirmado na migration original.
alter table tenant_billing drop constraint if exists tenant_billing_status_check;
alter table tenant_billing add constraint tenant_billing_status_check
  check (subscription_status in ('trial', 'active', 'past_due', 'cancelled', 'expired', 'suspended', 'trial_expired'));
