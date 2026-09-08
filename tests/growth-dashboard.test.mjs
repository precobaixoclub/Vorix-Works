import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresSubscriptionRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresPlanVersionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresProductEventRepository } from "../dist/infrastructure/storage/postgres/postgres-product-event-repository.js";
import { PostgresGrowthMetricsRepository } from "../dist/infrastructure/storage/postgres/postgres-growth-metrics-repository.js";
import { recordProductEvent, recordFirstEvent } from "../dist/application/product-analytics/product-analytics-use-cases.js";
import { getGrowthDashboard } from "../dist/application/growth/growth-dashboard-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Growth Dashboard — Fatia E. Foco: (1) MRR/ARR/ARPU são somados a partir de assinaturas REAIS
 * (nunca um número inventado — cada assinatura ativa entra com o preço mensal-equivalente do seu
 * PlanVersion real); (2) FREE (preço 0) nunca conta como cliente pagante; (3) o funil conta
 * ocorrências/distintos corretamente a partir de product_events; (4) `unavailableMetrics` sempre
 * documenta o que este modelo não permite calcular, nunca aproxima.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55994 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function dashboardDeps() {
  return { growthMetricsRepository: new PostgresGrowthMetricsRepository(db.pool) };
}

function analyticsDeps() {
  return { productEventRepository: new PostgresProductEventRepository(db.pool), enabled: true };
}

test("getGrowthDashboard: MRR/ARR/ARPU somados a partir de assinaturas reais; FREE nunca conta como pagante", async () => {
  const subscriptionRepository = new PostgresSubscriptionRepository(db.pool);
  const planVersionRepository = new PostgresPlanVersionRepository(db.pool);
  const freeVersion = await planVersionRepository.getActiveVersion("FREE");
  const startVersion = await planVersionRepository.getActiveVersion("START");
  const proVersion = await planVersionRepository.getActiveVersion("PRO");

  // Um tenant no FREE (ativo, mas preço 0 — nunca deve entrar na receita nem em "pagante").
  await subscriptionRepository.create({ tenantId: "tenant-growth-free", planVersionId: freeVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "monthly" });
  // Um tenant PRO mensal.
  await subscriptionRepository.create({ tenantId: "tenant-growth-pro", planVersionId: proVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "monthly" });
  // Um tenant START anual (mensal-equivalente = yearlyPriceUsd / 12).
  await subscriptionRepository.create({ tenantId: "tenant-growth-start-yearly", planVersionId: startVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "yearly" });
  // Um trial e um trial vencido — nunca contam como receita, só como status.
  await subscriptionRepository.create({ tenantId: "tenant-growth-trial", planVersionId: proVersion.id, status: "trial", billingProvider: "none", billingInterval: "monthly" });
  await subscriptionRepository.create({ tenantId: "tenant-growth-trial-expired", planVersionId: proVersion.id, status: "trial_expired", billingProvider: "none", billingInterval: "monthly" });

  const dashboard = await getGrowthDashboard(dashboardDeps());

  const expectedMrr = Math.round((Number(proVersion.monthlyPriceUsd) + Number(startVersion.yearlyPriceUsd) / 12) * 100) / 100;
  assert.equal(dashboard.revenue.payingCustomers, 2, "FREE (preço 0) nunca conta como cliente pagante, mesmo estando 'active'");
  assert.equal(dashboard.revenue.mrrUsd, expectedMrr);
  assert.equal(dashboard.revenue.arrUsd, Math.round(expectedMrr * 12 * 100) / 100);
  assert.equal(dashboard.revenue.arpuUsd, Math.round((expectedMrr / 2) * 100) / 100);

  assert.equal(dashboard.subscriptionsByStatus.trial, 1);
  assert.equal(dashboard.subscriptionsByStatus.trial_expired, 1);
  assert.equal(dashboard.subscriptionsByStatus.active, 3);

  assert.ok(dashboard.unavailableMetrics.length > 0, "limitações reais (churn/expansion MRR, DAU/retenção, cohorts) precisam estar documentadas, nunca aproximadas");
});

test("getGrowthDashboard: funil conta visitantes distintos e marcos por workspace corretamente", async () => {
  const analytics = analyticsDeps();

  // Dois visitantes distintos (mesmo anonymousId repetido não deve contar duas vezes).
  await recordProductEvent(analytics, { eventName: "landing_view", source: "client", anonymousId: "anon-funnel-1" });
  await recordProductEvent(analytics, { eventName: "landing_view", source: "client", anonymousId: "anon-funnel-1" });
  await recordProductEvent(analytics, { eventName: "landing_view", source: "client", anonymousId: "anon-funnel-2" });

  await recordProductEvent(analytics, { eventName: "signup_completed", source: "server", tenantId: "tenant-funnel-1", userId: "user-funnel-1" });

  // Um workspace concluiu onboarding; outro workspace não concluiu onboarding mas já teve um
  // marco de ativação (first_deal_created) — "ativados" precisa contar os DOIS (união dos marcos).
  await recordFirstEvent(analytics, { eventName: "onboarding_started", source: "server", tenantId: "tenant-funnel-1", workspaceId: "workspace-funnel-onb" });
  await recordProductEvent(analytics, { eventName: "onboarding_completed", source: "server", tenantId: "tenant-funnel-1", workspaceId: "workspace-funnel-onb" });
  await recordFirstEvent(analytics, { eventName: "first_deal_created", source: "server", tenantId: "tenant-funnel-2", workspaceId: "workspace-funnel-deal" });

  const dashboard = await getGrowthDashboard(dashboardDeps());

  const byStage = Object.fromEntries(dashboard.funnel.map((entry) => [entry.stage, entry.count]));
  assert.equal(byStage["Visitantes (landing_view)"], 2);
  assert.equal(byStage["Cadastros"], 1);
  assert.equal(byStage["Onboarding concluído"], 1);
  assert.equal(byStage["Ativados (marco de valor)"], 2, "ativação é a UNIÃO de qualquer marco — onboarding concluído OU first_deal_created contam, mesmo em workspaces diferentes");
});
