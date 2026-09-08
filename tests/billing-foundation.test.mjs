import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresUsageCounterRepository } from "../dist/infrastructure/storage/postgres/postgres-usage-counter-repository.js";
import { PostgresPaymentWebhookEventRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { canUse, getLimit, assertCanUse, assertWithinLimit, resolveEffectiveEntitlements } from "../dist/application/billing/entitlement-use-cases.js";
import { publishPlanVersion } from "../dist/application/billing/plan-version-use-cases.js";
import { DefaultResourceCounterAdapter } from "../dist/infrastructure/billing/resource-counter-adapter.js";
import { SandboxBillingProvider } from "../dist/infrastructure/billing/sandbox-billing-provider.js";
import { createContact } from "../dist/application/crm/contact-use-cases.js";
import { PostgresContactIdentityRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * SaaS Commercialization — Fase 1 (Billing Foundation). Foco: (1) `resolveEffectiveEntitlements`
 * funciona SEM nenhuma `Subscription` real (assinatura "virtual" a partir de `tenant_billing.
 * plan_code`) — todo tenant existente antes desta fase já funciona sem backfill; (2) uma
 * `Subscription` real muda o resultado pra `virtual: false` e usa o `PlanVersion` dela; (3)
 * add-ons (`SubscriptionItem`) somam sobre os limites base; (4) `canUse`/`assertCanUse` e
 * `getLimit`/`assertWithinLimit`; (5) versionar um plano nunca destrói a versão anterior; (6)
 * idempotência do log de webhook de pagamento; (7) `ResourceCounterPort` conta dado real (nunca
 * uma lista paginada); (8) `SandboxBillingProvider` cumpre o contrato sem chamada externa.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55707 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

function entitlementDeps() {
  return {
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    subscriptionItemRepository: new PostgresSubscriptionItemRepository(db.pool),
    planVersionRepository: new PostgresPlanVersionRepository(db.pool),
    addonDefinitionRepository: new PostgresAddonDefinitionRepository(db.pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    usageCounterRepository: new PostgresUsageCounterRepository(db.pool),
    resourceCounter: new DefaultResourceCounterAdapter({
      tenantMembershipRepository: new PostgresTenantMembershipRepository(db.pool),
      workspaceRepository: new PostgresWorkspaceRepository(db.pool),
      messagingConnectionRepository: { listByWorkspace: async () => [] },
      contactRepository: new PostgresContactRepository(db.pool),
      automationRuleRepository: { listByWorkspace: async () => [] },
    }),
  };
}

test("Migrations 0103-0109 aplicam sem erro; catálogo de planos e add-ons semeado", async () => {
  for (const id of [
    "0103_billing_plan_versions", "0104_billing_addon_definitions", "0105_billing_subscriptions",
    "0106_billing_usage_counters", "0107_billing_payment_methods_invoices", "0108_billing_events_and_webhooks",
    "0109_tenant_billing_subscription_link",
  ]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
  const planVersions = await db.pool.query("select plan_code from plan_versions where version = 1");
  assert.equal(planVersions.rows.length, 5);
  const addons = await db.pool.query("select code from addon_definitions");
  assert.ok(addons.rows.length >= 6);
});

test("Entitlements: tenant sem Subscription resolve como virtual, a partir de tenant_billing.plan_code (FREE)", async () => {
  const tenantId = "tenant-billing-1";
  const platformBillingRepository = new PostgresPlatformBillingRepository(db.pool);
  await platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });

  const entitlements = await resolveEffectiveEntitlements(entitlementDeps(), tenantId);
  assert.equal(entitlements.virtual, true);
  assert.equal(entitlements.planCode, "FREE");
  assert.equal(entitlements.capabilities.crm, true);
  assert.equal(entitlements.capabilities.automation, false);
  assert.equal(entitlements.limits.workspaces, 1);

  assert.equal(await canUse(entitlementDeps(), { tenantId, capability: "crm" }), true);
  assert.equal(await canUse(entitlementDeps(), { tenantId, capability: "automation" }), false);
  await assert.rejects(() => assertCanUse(entitlementDeps(), { tenantId, capability: "automation" }), /ENTITLEMENT_DENIED/);
});

test("Entitlements: uma Subscription real (PRO) muda virtual para false e usa os limites do PlanVersion dela", async () => {
  const tenantId = "tenant-billing-2";
  const deps = entitlementDeps();
  const platformBillingRepository = deps.platformBillingRepository;
  await platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });

  const proVersion = await deps.planVersionRepository.getActiveVersion("PRO");
  await deps.subscriptionRepository.create({
    tenantId, planVersionId: proVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "monthly",
  });

  const entitlements = await resolveEffectiveEntitlements(deps, tenantId);
  assert.equal(entitlements.virtual, false);
  assert.equal(entitlements.planCode, "PRO");
  assert.equal(entitlements.capabilities.automation, true);
  assert.equal(entitlements.limits.users, 8);
});

test("Entitlements: add-on de usuário soma sobre o limite base do plano", async () => {
  const tenantId = "tenant-billing-3";
  const deps = entitlementDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const startVersion = await deps.planVersionRepository.getActiveVersion("START");
  const subscription = await deps.subscriptionRepository.create({
    tenantId, planVersionId: startVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "monthly",
  });
  assert.equal(startVersion.limits.users, 3);

  await deps.subscriptionItemRepository.create({ subscriptionId: subscription.id, addonCode: "extra_user", quantity: 2, unitPriceUsd: 15 });

  const entitlements = await resolveEffectiveEntitlements(deps, tenantId);
  assert.equal(entitlements.limits.users, 5, "3 do plano + 2 do addon (quantity=2, increment=1 cada)");
});

test("Limite: assertWithinLimit lança USAGE_LIMIT_REACHED quando o uso real atinge o teto do plano", async () => {
  const tenantId = "tenant-billing-4";
  const deps = entitlementDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const workspace = await makeWorkspace(tenantId);

  const contactDeps = {
    contactRepository: new PostgresContactRepository(db.pool),
    contactIdentityRepository: new PostgresContactIdentityRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
  };

  // FREE permite 200 contatos — não deveria bloquear ainda.
  await createContact(contactDeps, { tenantId, workspaceId: workspace.id, name: "Contato 1" });
  const { used, max } = await getLimit(deps, { tenantId, resource: "contacts" });
  assert.equal(used, 1);
  assert.equal(max, 200);
  await assertWithinLimit(deps, { tenantId, resource: "contacts" });

  // Publica uma versão de teste do FREE com limite de 1 contato só, e migra o tenant pra ela via
  // uma Subscription real — prova que o bloqueio reage ao limite de verdade, não a um número fixo.
  const tightVersion = await publishPlanVersion(deps, {
    planCode: "FREE", name: "Gratuito (teste)", tagline: "t", monthlyPriceUsd: 0, yearlyPriceUsd: 0,
    capabilities: { crm: true, conversations: true, marketing: true, proposals: false, automation: false, ai_auto_reply: false, advanced_analytics: false },
    limits: { users: 1, workspaces: 1, messaging_connections: 1, contacts: 1, ai_credits: 50, storage_mb: 100, automations: 0 },
    allowedAddonCodes: [], trialDays: null,
  });
  await deps.subscriptionRepository.create({ tenantId, planVersionId: tightVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "monthly" });

  await assert.rejects(() => assertWithinLimit(deps, { tenantId, resource: "contacts" }), /USAGE_LIMIT_REACHED/);
});

test("Versionamento: publicar uma nova versão nunca sobrescreve nem afeta quem já está na anterior", async () => {
  const deps = entitlementDeps();
  const before = await deps.planVersionRepository.getActiveVersion("BUSINESS");
  const next = await publishPlanVersion(deps, {
    planCode: "BUSINESS", name: "Business v2", tagline: "t", monthlyPriceUsd: 299, yearlyPriceUsd: 2990,
    capabilities: before.capabilities, limits: { ...before.limits, users: 40 }, allowedAddonCodes: [], trialDays: 14,
  });
  assert.equal(next.version, before.version + 1);

  const stillThere = await deps.planVersionRepository.getById(before.id);
  assert.equal(stillThere.limits.users, before.limits.users, "a versão antiga nunca muda");

  const active = await deps.planVersionRepository.getActiveVersion("BUSINESS");
  assert.equal(active.id, next.id, "getActiveVersion sempre pega a mais nova");
});

test("Webhook de pagamento: registrar o mesmo (provider, providerEventId) duas vezes é idempotente", async () => {
  const repo = new PostgresPaymentWebhookEventRepository(db.pool);
  const first = await repo.record({ provider: "stripe", providerEventId: "evt_test_1", eventType: "checkout.session.completed", payload: { a: 1 } });
  assert.equal(first.wasCreated, true);
  const second = await repo.record({ provider: "stripe", providerEventId: "evt_test_1", eventType: "checkout.session.completed", payload: { a: 1 } });
  assert.equal(second.wasCreated, false);
  assert.equal(second.event.id, first.event.id);
});

test("ResourceCounterPort: conta usuários e workspaces reais do tenant (nunca uma lista paginada)", async () => {
  const tenantId = "tenant-billing-5";
  const userRepo = new PostgresUserRepository(db.pool);
  const membershipRepo = new PostgresTenantMembershipRepository(db.pool);
  const user1 = await userRepo.create({ email: "u1@example.com", name: "U1", passwordHash: "x" });
  const user2 = await userRepo.create({ email: "u2@example.com", name: "U2", passwordHash: "x" });
  await membershipRepo.create({ userId: user1.id, tenantId, role: "owner" });
  await membershipRepo.create({ userId: user2.id, tenantId, role: "editor" });
  await makeWorkspace(tenantId);
  await makeWorkspace(tenantId);

  const counter = new DefaultResourceCounterAdapter({
    tenantMembershipRepository: membershipRepo,
    workspaceRepository: new PostgresWorkspaceRepository(db.pool),
    messagingConnectionRepository: { listByWorkspace: async () => [] },
    contactRepository: new PostgresContactRepository(db.pool),
    automationRuleRepository: { listByWorkspace: async () => [] },
  });

  assert.equal(await counter.count({ tenantId, resource: "users" }), 2);
  assert.equal(await counter.count({ tenantId, resource: "workspaces" }), 2);
  assert.equal(await counter.count({ tenantId, resource: "ai_credits" }), undefined, "ai_credits não é contado por linhas");
});

test("SandboxBillingProvider cumpre o contrato do BillingProviderPort sem nenhuma chamada externa", async () => {
  const provider = new SandboxBillingProvider();
  const checkout = await provider.createCheckout({
    tenantId: "t1", planVersionId: "planv-1", providerPlanPriceRef: "price_x", billingInterval: "monthly",
    customerEmail: "a@b.com", successUrl: "https://vorixworks.com/sucesso", cancelUrl: "https://vorixworks.com/cancelado",
  });
  assert.equal(checkout.ok, true);
  assert.ok(checkout.checkoutUrl.startsWith("https://vorixworks.com/sucesso"));

  const webhook = await provider.handleWebhook({ rawBody: Buffer.from(JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { foo: "bar" } })), signatureHeader: undefined });
  assert.equal(webhook.ok, true);
  assert.equal(webhook.event.eventType, "checkout.session.completed");
});
