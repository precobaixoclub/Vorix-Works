-- 0109 — SaaS Commercialization, Fase 1: liga `tenant_billing` (Sprint 25, já em produção) à
-- nova `subscriptions`/`plan_versions`, de forma aditiva — nenhuma coluna existente muda de
-- significado, nenhum código que já lê `plan_code`/`subscription_status` quebra. `null` aqui é o
-- estado normal de todo tenant criado antes desta fase (resolvido como assinatura "virtual" pela
-- camada de entitlements, ver `entitlement-use-cases.ts`) — nunca backfillado à força.

alter table tenant_billing add column if not exists subscription_id text references subscriptions (id) on delete set null;
alter table tenant_billing add column if not exists plan_version_id text references plan_versions (id) on delete set null;
