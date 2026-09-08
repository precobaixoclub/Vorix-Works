import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresWorkspaceOnboardingRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-onboarding-repository.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresTenantMemberInviteRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-member-invite-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresUsageCounterRepository } from "../dist/infrastructure/storage/postgres/postgres-usage-counter-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { FakeMessagingProvider } from "../dist/infrastructure/messaging/fake-messaging-provider.js";
import { DefaultResourceCounterAdapter } from "../dist/infrastructure/billing/resource-counter-adapter.js";
import {
  advanceOnboardingStep,
  completeOnboarding,
  connectChannelDuringOnboarding,
  getOnboarding,
  inviteTeamMemberDuringOnboarding,
  saveCompanyStep,
  startOnboarding,
} from "../dist/application/onboarding/onboarding-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Onboarding guiado — foco: (1) idempotência (iniciar/avançar/completar duas vezes nunca duplica
 * nada); (2) progresso persiste e é isolado por workspace/tenant; (3) convite/conexão durante o
 * onboarding reusam integralmente `inviteMember`/`createConnection` e respeitam entitlements
 * (limite de plano + modo somente-leitura de `past_due`, sem nenhuma checagem duplicada); (4)
 * nunca cria uma segunda conexão/convite pro mesmo workspace/email.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55951 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function onboardingDeps() {
  const inviteDeps = {
    tenantMemberInviteRepository: new PostgresTenantMemberInviteRepository(db.pool),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool),
    userRepository: new PostgresUserRepository(db.pool),
  };
  const inboxDeps = {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool),
    outboundQueue: { enqueue: async () => {} },
    provider: new FakeMessagingProvider(),
  };
  const entitlementDeps = {
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    subscriptionItemRepository: new PostgresSubscriptionItemRepository(db.pool),
    planVersionRepository: new PostgresPlanVersionRepository(db.pool),
    addonDefinitionRepository: new PostgresAddonDefinitionRepository(db.pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    usageCounterRepository: new PostgresUsageCounterRepository(db.pool),
    resourceCounter: new DefaultResourceCounterAdapter({
      tenantMembershipRepository: new PostgresTenantMembershipRepository(db.pool),
      workspaceRepository: new PostgresWorkspaceRepository(db.pool),
      messagingConnectionRepository: new PostgresMessagingConnectionRepository(db.pool),
      contactRepository: new PostgresContactRepository(db.pool),
      automationRuleRepository: { listByWorkspace: async () => [] },
    }),
  };
  return {
    workspaceOnboardingRepository: new PostgresWorkspaceOnboardingRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool),
    entitlementDeps,
    inviteDeps,
    inboxDeps,
  };
}

async function makeTenantWithWorkspace(tenantId) {
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const user = await new PostgresUserRepository(db.pool).create({ email: `${tenantId}-owner@example.com`, name: "Dona", passwordHash: "x" });
  await new PostgresTenantMembershipRepository(db.pool).create({ userId: user.id, tenantId, role: "owner" });
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: `Workspace de ${tenantId}` });
  return { workspace, userId: user.id };
}

test("startOnboarding: novo workspace entra em onboarding; chamar duas vezes nunca duplica a linha", async () => {
  const deps = onboardingDeps();
  const { workspace } = await makeTenantWithWorkspace("tenant-onb-1");

  const first = await startOnboarding(deps, { tenantId: "tenant-onb-1", workspaceId: workspace.id });
  assert.equal(first.status, "in_progress");
  assert.equal(first.currentStep, "company");
  assert.deepEqual(first.completedSteps, []);

  const second = await startOnboarding(deps, { tenantId: "tenant-onb-1", workspaceId: workspace.id });
  assert.equal(second.id, first.id, "a segunda chamada devolve a MESMA linha, nunca cria outra");

  const count = await db.pool.query("select count(*)::int as c from workspace_onboarding where workspace_id = $1", [workspace.id]);
  assert.equal(count.rows[0].c, 1);
});

test("startOnboarding: outro tenant não acessa o progresso do primeiro (mesma mensagem de NOT_FOUND)", async () => {
  const deps = onboardingDeps();
  const { workspace } = await makeTenantWithWorkspace("tenant-onb-2");
  await startOnboarding(deps, { tenantId: "tenant-onb-2", workspaceId: workspace.id });

  await assert.rejects(() => getOnboarding(deps, { tenantId: "tenant-onb-intruso", workspaceId: workspace.id }), /ONBOARDING_WORKSPACE_NOT_FOUND/);
});

test("multiworkspace: dois workspaces do MESMO tenant têm progresso totalmente independente", async () => {
  const deps = onboardingDeps();
  const tenantId = "tenant-onb-3";
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const workspaceA = await workspaceRepo.create({ tenantId, name: "Workspace A" });
  const workspaceB = await workspaceRepo.create({ tenantId, name: "Workspace B" });

  await completeOnboarding(deps, { tenantId, workspaceId: workspaceA.id });
  const progressA = await getOnboarding(deps, { tenantId, workspaceId: workspaceA.id });
  const progressB = await getOnboarding(deps, { tenantId, workspaceId: workspaceB.id });

  assert.equal(progressA.status, "completed");
  assert.equal(progressB, undefined, "workspace B nunca foi iniciado — nunca herda o estado de A");
});

test("saveCompanyStep: salva segmento/tamanho/objetivo, avança para 'channel', e resume preserva o que já foi digitado", async () => {
  const deps = onboardingDeps();
  const { workspace } = await makeTenantWithWorkspace("tenant-onb-4");

  const saved = await saveCompanyStep(deps, { tenantId: "tenant-onb-4", workspaceId: workspace.id, segment: "imobiliaria", size: "1-5", goal: "sales" });
  assert.equal(saved.currentStep, "channel");
  assert.deepEqual(saved.completedSteps, ["company"]);

  // "Resume": fechar e reabrir simplesmente relê o progresso — nada se perde.
  const resumed = await getOnboarding(deps, { tenantId: "tenant-onb-4", workspaceId: workspace.id });
  assert.equal(resumed.companySegment, "imobiliaria");
  assert.equal(resumed.companySize, "1-5");
  assert.equal(resumed.primaryGoal, "sales");
  assert.equal(resumed.currentStep, "channel");
});

test("advanceOnboardingStep: pular uma etapa avança o wizard mas NUNCA marca como concluída (distinção pro checklist da Home)", async () => {
  const deps = onboardingDeps();
  const { workspace } = await makeTenantWithWorkspace("tenant-onb-5");
  await saveCompanyStep(deps, { tenantId: "tenant-onb-5", workspaceId: workspace.id, segment: "clinica" });

  const skipped = await advanceOnboardingStep(deps, { tenantId: "tenant-onb-5", workspaceId: workspace.id, step: "channel", skipped: true });
  assert.equal(skipped.currentStep, "team");
  assert.ok(!skipped.completedSteps.includes("channel"), "etapa pulada nunca entra em completedSteps");

  const completed = await advanceOnboardingStep(deps, { tenantId: "tenant-onb-5", workspaceId: workspace.id, step: "team" });
  assert.equal(completed.currentStep, "commercial");
  assert.ok(completed.completedSteps.includes("team"));
});

test("advanceOnboardingStep: chamar duas vezes com o MESMO step é idempotente (nunca duplica no array nem regride currentStep)", async () => {
  const deps = onboardingDeps();
  const { workspace } = await makeTenantWithWorkspace("tenant-onb-6");
  await startOnboarding(deps, { tenantId: "tenant-onb-6", workspaceId: workspace.id });

  await advanceOnboardingStep(deps, { tenantId: "tenant-onb-6", workspaceId: workspace.id, step: "company" });
  const again = await advanceOnboardingStep(deps, { tenantId: "tenant-onb-6", workspaceId: workspace.id, step: "company" });

  assert.deepEqual(again.completedSteps, ["company"], "nunca ['company','company']");
  assert.equal(again.currentStep, "channel", "não avança de novo — já tinha saído de 'company'");
});

test("completeOnboarding: idempotente — completar de novo nunca reseta completedAt nem regride o status", async () => {
  const deps = onboardingDeps();
  const { workspace } = await makeTenantWithWorkspace("tenant-onb-7");

  const first = await completeOnboarding(deps, { tenantId: "tenant-onb-7", workspaceId: workspace.id });
  assert.equal(first.status, "completed");
  assert.ok(first.completedAt);

  const second = await completeOnboarding(deps, { tenantId: "tenant-onb-7", workspaceId: workspace.id });
  assert.equal(second.completedAt, first.completedAt, "segunda chamada não reescreve completedAt");
});

test("inviteTeamMemberDuringOnboarding: reusa inviteMember de verdade; clicar duas vezes NUNCA cria dois convites pendentes", async () => {
  const deps = onboardingDeps();
  const { workspace, userId } = await makeTenantWithWorkspace("tenant-onb-8");
  await startOnboarding(deps, { tenantId: "tenant-onb-8", workspaceId: workspace.id });
  // FREE só permite 1 usuário (o owner já ocupa a vaga) — sobe pro PRO (8 usuários) pra testar
  // idempotência do convite em si, não o limite (que já tem teste dedicado abaixo).
  const proVersion = await deps.entitlementDeps.planVersionRepository.getActiveVersion("PRO");
  await deps.entitlementDeps.subscriptionRepository.create({ tenantId: "tenant-onb-8", planVersionId: proVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "monthly" });

  const first = await inviteTeamMemberDuringOnboarding(deps, { tenantId: "tenant-onb-8", workspaceId: workspace.id, email: "novo@empresa.com", role: "editor", invitedByUserId: userId });
  assert.equal(first.alreadyPending, false);

  const second = await inviteTeamMemberDuringOnboarding(deps, { tenantId: "tenant-onb-8", workspaceId: workspace.id, email: "novo@empresa.com", role: "editor", invitedByUserId: userId });
  assert.equal(second.alreadyPending, true);
  assert.equal(second.invite.id, first.invite.id);

  const count = await db.pool.query("select count(*)::int as c from tenant_member_invites where tenant_id = $1 and email = 'novo@empresa.com'", ["tenant-onb-8"]);
  assert.equal(count.rows[0].c, 1);

  const progress = await getOnboarding(deps, { tenantId: "tenant-onb-8", workspaceId: workspace.id });
  assert.ok(progress.completedSteps.includes("team"));
});

test("inviteTeamMemberDuringOnboarding: respeita o limite de usuários do plano (FREE = 1 usuário)", async () => {
  const deps = onboardingDeps();
  const { workspace, userId } = await makeTenantWithWorkspace("tenant-onb-9");
  // FREE permite 1 usuário — o owner já ocupa a única vaga.
  await assert.rejects(
    () => inviteTeamMemberDuringOnboarding(deps, { tenantId: "tenant-onb-9", workspaceId: workspace.id, email: "outro@empresa.com", role: "editor", invitedByUserId: userId }),
    /USAGE_LIMIT_REACHED/,
  );
});

test("connectChannelDuringOnboarding: reusa createConnection de verdade; chamar duas vezes reaproveita a MESMA conexão", async () => {
  const deps = onboardingDeps();
  const { workspace } = await makeTenantWithWorkspace("tenant-onb-10");
  await startOnboarding(deps, { tenantId: "tenant-onb-10", workspaceId: workspace.id });

  const first = await connectChannelDuringOnboarding(deps, { tenantId: "tenant-onb-10", workspaceId: workspace.id, displayName: "WhatsApp Principal" });
  assert.equal(first.reused, false);

  const second = await connectChannelDuringOnboarding(deps, { tenantId: "tenant-onb-10", workspaceId: workspace.id, displayName: "Outro nome" });
  assert.equal(second.reused, true);
  assert.equal(second.connection.id, first.connection.id, "nunca cria uma segunda conexão pro mesmo workspace");

  const count = await db.pool.query("select count(*)::int as c from messaging_connections where workspace_id = $1", [workspace.id]);
  assert.equal(count.rows[0].c, 1);
});

test("modo somente-leitura (past_due): onboarding não permite convidar nem conectar canal, sem nenhuma checagem duplicada", async () => {
  const deps = onboardingDeps();
  const tenantId = "tenant-onb-11";
  const { workspace, userId } = await makeTenantWithWorkspace(tenantId);
  const proVersion = await deps.entitlementDeps.planVersionRepository.getActiveVersion("PRO");
  await deps.entitlementDeps.subscriptionRepository.create({ tenantId, planVersionId: proVersion.id, status: "past_due", billingProvider: "sandbox", billingInterval: "monthly" });

  await assert.rejects(
    () => inviteTeamMemberDuringOnboarding(deps, { tenantId, workspaceId: workspace.id, email: "a@b.com", role: "editor", invitedByUserId: userId }),
    /ENTITLEMENT_ACCOUNT_READ_ONLY/,
  );
  await assert.rejects(
    () => connectChannelDuringOnboarding(deps, { tenantId, workspaceId: workspace.id, displayName: "WhatsApp" }),
    /ENTITLEMENT_ACCOUNT_READ_ONLY/,
  );
});
