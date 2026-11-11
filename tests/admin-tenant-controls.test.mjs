import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import Fastify from 'fastify';
import { startTestPostgres } from './helpers/pglite-test-db.mjs';
import { applyMigrations } from '../dist/infrastructure/storage/postgres/migration-runner.js';
import { PostgresPlatformBillingRepository } from '../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js';
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from '../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js';
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from '../dist/infrastructure/storage/postgres/postgres-subscription-repository.js';
import { PostgresUsageCounterRepository } from '../dist/infrastructure/storage/postgres/postgres-usage-counter-repository.js';
import { PostgresContactRepository } from '../dist/infrastructure/storage/postgres/postgres-contact-repository.js';
import { PostgresWorkspaceRepository } from '../dist/infrastructure/storage/postgres/postgres-workspace-repository.js';
import { defaultTenantControls } from '../dist/domain/platform-billing/tenant-controls.model.js';
import { resolveEffectiveEntitlements, resolveContractEntitlements } from '../dist/application/billing/entitlement-use-cases.js';
import { registerAdminTenantContractRoutes } from '../dist/interfaces/api/routes/v1/admin-tenant-contract.route.js';
import { registerTenantContractGuard, capabilityForPath } from '../dist/interfaces/api/http/tenant-contract-guard.js';
import { registerErrorHandler } from '../dist/interfaces/api/http/error-handler.js';
import { CreditAccountingService } from '../dist/application/ai-providers/credit-accounting.service.js';
import { SolutionAccessService } from '../dist/application/solutions/solution-access.service.js';
import { SocialProviderResolver, SocialProviderRegistry } from '../dist/application/social/social-provider-resolver.js';
import { changeTenantPlan } from '../dist/application/platform-admin/platform-admin.usecases.js';
import { getTenantCredits } from '../dist/application/workspace/workspace-use-cases.js';
import { getAiCreditsOverview } from '../dist/application/billing/ai-credits-use-cases.js';
import { syncMeetingsEntitlementFromSubscription } from '../dist/application/billing/meetings-offer.js';
let db; let deps;
before(async () => {
  db = await startTestPostgres(); await applyMigrations(db.pool, join(process.cwd(), 'db/migrations'));
  deps = { platformBillingRepository: new PostgresPlatformBillingRepository(db.pool), planVersionRepository: new PostgresPlanVersionRepository(db.pool), addonDefinitionRepository: new PostgresAddonDefinitionRepository(db.pool), subscriptionRepository: new PostgresSubscriptionRepository(db.pool), subscriptionItemRepository: new PostgresSubscriptionItemRepository(db.pool), usageCounterRepository: new PostgresUsageCounterRepository(db.pool), resourceCounter: { count: async () => 0 }, subscriptionPendingChangeRepository: { listPendingByTenant: async () => [] } };
});
after(async () => db?.stop());
async function account(tenantId) { await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() }); }
async function save(tenantId, patch, reason = 'Negociação administrativa de teste') { const current = await deps.platformBillingRepository.getTenantControls(tenantId); return deps.platformBillingRepository.saveTenantControls({ controls: { ...current, ...patch }, expectedVersion: current.version, actorUserId: 'platform-owner', reason }); }

test('overrides preserve true paid contract and addons, enforce explicit false and zero, and restore inheritance', async () => {
  const tenantId = 'tenant-controls-paid'; await account(tenantId);
  const plan = await deps.planVersionRepository.getActiveVersion('PRO');
  const sub = await deps.subscriptionRepository.create({ tenantId, planVersionId: plan.id, status: 'active', billingProvider: 'sandbox', billingInterval: 'monthly' });
  await deps.subscriptionItemRepository.create({ subscriptionId: sub.id, addonCode: 'extra_user', quantity: 2, unitPriceUsd: 39, currency: 'BRL' });
  const original = await resolveContractEntitlements(deps, tenantId);
  await save(tenantId, { capabilities: { proposals: false }, limits: { users: 0, contacts: null }, accessMode: 'blocked' });
  const effective = await resolveEffectiveEntitlements(deps, tenantId);
  assert.equal(effective.readOnly, true); assert.equal(effective.capabilities.proposals, false); assert.equal(effective.limits.users, 0); assert.equal(effective.limits.contacts, null);
  assert.deepEqual(await resolveContractEntitlements(deps, tenantId), original);
  await save(tenantId, { capabilities: {}, limits: {}, accessMode: 'inherit' });
  assert.deepEqual(await resolveEffectiveEntitlements(deps, tenantId), original);
  assert.equal((await deps.subscriptionItemRepository.listBySubscription(sub.id))[0].quantity, 2);
});
test('controls persist actor/reason/before/after and reject stale writes without duplicate audit', async () => {
  const tenantId = 'tenant-controls-cas'; await account(tenantId);
  const saved = await save(tenantId, { displayName: 'Conta identificável', capabilities: { proposals: true } });
  await assert.rejects(deps.platformBillingRepository.saveTenantControls({ controls: { ...saved, displayName: 'Stale' }, expectedVersion: 0, actorUserId: 'other-admin', reason: 'Stale write' }), /CONFLICT/);
  const history = await deps.platformBillingRepository.listTenantControlChanges(tenantId);
  assert.equal(history.length, 1); assert.equal(history[0].actorUserId, 'platform-owner'); assert.equal(history[0].before.version, 0); assert.equal(history[0].after.displayName, 'Conta identificável');
});
test('paid account suspension cannot be bypassed by a still-active real subscription', async () => {
  const tenantId = 'tenant-controls-paid'; await save(tenantId, { accessMode: 'blocked' });
  assert.equal((await resolveContractEntitlements(deps, tenantId)).readOnly, false);
  assert.equal((await resolveEffectiveEntitlements(deps, tenantId)).readOnly, true);
  const service = new SolutionAccessService({ repository: { listByTenant: async () => [{ solutionKey: 'marketing', enabled: true, source: 'manual' }] }, administrativeAccess: async id => (await deps.platformBillingRepository.getTenantControls(id)).accessMode !== 'blocked' });
  assert.equal((await service.listAccess(tenantId)).some(solution => solution.enabled), false);
  await save(tenantId, { accessMode: 'inherit' });
});
test('manual quotas guard repository writes from API and worker entry points, preserving existing contacts', async () => {
  const tenantId = 'tenant-controls-allocation'; await account(tenantId);
  const workspace = await new PostgresWorkspaceRepository(db.pool).create({ tenantId, name: 'Preserved data' });
  const contacts = new PostgresContactRepository(db.pool, true);
  await save(tenantId, { limits: { contacts: 1 } });
  await contacts.create({ tenantId, workspaceId: workspace.id, name: 'Real contact', customFields: { phone: '+5511999999999' } });
  await assert.rejects(contacts.create({ tenantId, workspaceId: workspace.id, name: 'Too many', customFields: { phone: '+5511988888888' } }), /USAGE_LIMIT_REACHED/);
  assert.equal(Number((await db.pool.query('select count(*) from contacts where tenant_id=$1', [tenantId])).rows[0].count), 1);
  await save(tenantId, { limits: { contacts: null } });
  await contacts.create({ tenantId, workspaceId: workspace.id, name: 'Second', customFields: { phone: '+5511988888888' } });
  await save(tenantId, { capabilities: { crm: false } });
  await assert.rejects(contacts.create({ tenantId, workspaceId: workspace.id, name: 'Blocked CRM', customFields: { phone: '+5511977777777' } }), /ENTITLEMENT_DENIED/);
});
test('AI blocks manual account/auto-reply restrictions and honors unlimited monthly credits', async () => {
  const tenantId = 'tenant-controls-ai'; await account(tenantId);
  const credit = new CreditAccountingService({ platformBillingRepository: deps.platformBillingRepository, aiProvidersRepository: { getOperationType: async () => ({ active: true, creditsCost: 999999 }) }, idGenerator: () => 'id' });
  await save(tenantId, { accessMode: 'blocked', limits: { ai_credits: null } });
  assert.equal((await credit.checkAvailability(tenantId, 'inbox_auto_reply', new Date())).reason, 'account_blocked');
  await save(tenantId, { accessMode: 'inherit', capabilities: { ai_auto_reply: false } });
  assert.equal((await credit.checkAvailability(tenantId, 'inbox_auto_reply', new Date())).ok, false);
  assert.equal((await credit.checkAvailability(tenantId, 'generate_text', new Date())).ok, true);
});
test('background social resolver pauses publishing when administrative entitlement is denied', async () => {
  const resolver = new SocialProviderResolver(new SocialProviderRegistry(), { getPolicy: async () => ({ publishingEnabled: true, tenantId: 't', network: 'instagram' }) }, undefined, async () => false);
  assert.equal((await resolver.policyFor('t', 'instagram')).publishingEnabled, false);
});
test('subscription renewal does not undo an administrator Meetings block or negotiated recording limits', async () => {
  for (const current of [
    { solutionKey: 'meetings', enabled: false, source: 'manual', limits: { maxConcurrentRecordings: 1 } },
    { solutionKey: 'meetings', enabled: true, source: 'manual', limits: { maxConcurrentRecordings: 1, monthlyRecordingMinutes: 1200 } },
    { solutionKey: 'meetings', enabled: true, source: 'internal', limits: { maxConcurrentRecordings: 5 } },
  ]) {
    let writes = 0;
    const result = await syncMeetingsEntitlementFromSubscription({ subscriptionRepository: { getActiveByTenant: async () => ({ id: 'paid', status: 'active' }) }, subscriptionItemRepository: { listBySubscription: async () => [{ addonCode: 'meetings_base', quantity: 3 }] }, addonDefinitionRepository: { getByCode: async () => ({ resource: 'meetings_concurrent_recordings', increment: 1 }) }, solutionEntitlementRepository: { listByTenant: async () => [current], set: async () => { writes++; } } }, 'tenant-managed');
    assert.equal(result.concurrentRecordings, 3); assert.equal(writes, 0);
  }
});
test('manual AI quota agrees across legacy balance views and unlimited mode without rewriting the contracted quota', async () => {
  const tenantId = 'tenant-controls-credit-views'; await account(tenantId);
  const original = (await deps.platformBillingRepository.getTenantBilling(tenantId)).monthlyCreditsQuota;
  await save(tenantId, { limits: { ai_credits: 250 } });
  assert.equal((await getTenantCredits(deps, { tenantId })).remainingCredits, 250);
  assert.equal((await deps.platformBillingRepository.listAllTenantBilling()).find(row => row.tenantId === tenantId).monthlyCreditsQuota, 250);
  assert.equal(Number((await db.pool.query('select monthly_credits_quota from tenant_billing where tenant_id=$1', [tenantId])).rows[0].monthly_credits_quota), original);
  const overviewDeps = { ...deps, billingProvider: { supportsOffSessionCharge: false }, aiCreditPurchaseRepository: { listByTenant: async () => [] }, pricing: { unitPriceCents: 10, minPurchase: 100, maxPurchase: 100000, currency: 'BRL' } };
  assert.equal((await getAiCreditsOverview(overviewDeps, tenantId)).monthlyQuota, 250);
  await save(tenantId, { limits: { ai_credits: null } });
  assert.equal((await getAiCreditsOverview(overviewDeps, tenantId)).monthlyUnlimited, true);
  assert.equal((await getTenantCredits(deps, { tenantId })).monthlyCreditsQuota, Number.MAX_SAFE_INTEGER);
  await save(tenantId, { limits: {} });
  assert.equal((await getTenantCredits(deps, { tenantId })).monthlyCreditsQuota, original);
});
test('admin plan endpoint routes a real contract through billing provider, never silently changes the mirror', async () => {
  let providerCalled = false; let mirrorCalled = false;
  const plan = await deps.planVersionRepository.getActiveVersion('START');
  const contractDeps = { ...deps, subscriptionRepository: { getActiveByTenant: async () => ({ id: 'sub', planVersionId: plan.id, providerSubscriptionId: 'real-provider-id', billingInterval: 'monthly' }) }, billingProvider: { providerId: 'sandbox', changeSubscription: async () => { providerCalled = true; return { ok: false, kind: 'unavailable', message: 'fixture failure' }; } } };
  await assert.rejects(changeTenantPlan({ ...deps, contractDeps, platformBillingRepository: { updateTenantBilling: async () => { mirrorCalled = true; } }, now: () => new Date() }, { tenantId: 'tenant-test', planCode: 'PRO', actor: { userId: 'admin' } }), /CHANGE_PLAN_PROVIDER_ERROR/);
  assert.equal(providerCalled, true); assert.equal(mirrorCalled, false);
});
test('HTTP controls require platform admin and reject unknown fields, negative quotas, stale versions and nonexistent accounts', async () => {
  const app = Fastify(); registerErrorHandler(app);
  app.addHook('onRequest', async request => { request.zunoContext = { principal: { tenantId: 'tenant-controls-cas', userId: 'platform-owner', isPlatformAdmin: request.headers['x-admin'] === 'yes' } }; });
  await registerAdminTenantContractRoutes(app, deps);
  const contractResponse = await app.inject({ url: '/admin/tenants/tenant-controls-paid/contract', headers: { 'x-admin': 'yes' } });
  assert.equal(contractResponse.statusCode, 200, contractResponse.body);
  const contractData = contractResponse.json().data;
  assert.equal(contractData.contract.virtual, false); assert.equal(contractData.addons[0].quantity, 2);
  assert.equal(Object.hasOwn(contractData.subscription, 'providerSubscriptionId'), false);
  const body = { expectedVersion: 1, reason: 'Contrato negociado', accessMode: 'inherit', capabilities: {}, limits: { users: 2, contacts: null } };
  const url = '/admin/tenants/tenant-controls-cas/controls';
  assert.equal((await app.inject({ method: 'PUT', url, payload: body })).statusCode, 403);
  for (const payload of [{ ...body, limits: { users: -1 } }, { ...body, capabilities: { invented: true } }, { ...body, tenantId: 'other' }, { ...body, limits: { storage_mb: 50 } }]) assert.equal((await app.inject({ method: 'PUT', url, headers: { 'x-admin': 'yes' }, payload })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/admin/tenants/tenant-does-not-exist/controls', headers: { 'x-admin': 'yes' }, payload: body })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PUT', url, headers: { 'x-admin': 'yes' }, payload: body })).statusCode, 200);
  // "Ilimitado" (null) must survive HTTP validation; type coercion used to persist it as 0.
  assert.deepEqual((await deps.platformBillingRepository.getTenantControls('tenant-controls-cas')).limits, { users: 2, contacts: null });
  assert.equal((await app.inject({ method: 'PUT', url, headers: { 'x-admin': 'yes' }, payload: body })).statusCode, 409);
  await app.close();
});
test('server guard blocks a manually restricted feature even for an admin operating its workspace; recovery stays reachable', async () => {
  const tenantId = 'tenant-controls-http'; await account(tenantId); await save(tenantId, { capabilities: { proposals: false }, accessMode: 'blocked' });
  const app = Fastify(); registerErrorHandler(app);
  app.addHook('onRequest', async request => { request.zunoContext = { principal: { tenantId, userId: 'admin', isPlatformAdmin: true } }; });
  registerTenantContractGuard(app, deps);
  for (const url of ['/v1/proposals', '/v1/admin/recovery', '/v1/billing/recovery']) app.get(url, async () => ({ ok: true }));
  assert.equal((await app.inject('/v1/proposals')).statusCode, 403);
  assert.equal((await app.inject('/v1/admin/recovery')).statusCode, 200); assert.equal((await app.inject('/v1/billing/recovery')).statusCode, 200);
  assert.equal(capabilityForPath('/v1/inbox/conversations/abc/proposals'), 'proposals');
  assert.equal(capabilityForPath('/v1/commercial-metrics'), 'advanced_analytics');
  await app.close();
});
