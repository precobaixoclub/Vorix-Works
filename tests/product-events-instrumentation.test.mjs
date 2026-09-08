import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresProductEventRepository } from "../dist/infrastructure/storage/postgres/postgres-product-event-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresProposalRepository } from "../dist/infrastructure/storage/postgres/postgres-proposal-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { PostgresTenantMemberInviteRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-member-invite-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresWorkspaceOnboardingRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-onboarding-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresUsageCounterRepository } from "../dist/infrastructure/storage/postgres/postgres-usage-counter-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { FakeMessagingProvider } from "../dist/infrastructure/messaging/fake-messaging-provider.js";
import { DefaultResourceCounterAdapter } from "../dist/infrastructure/billing/resource-counter-adapter.js";
import { createPipeline, createStage } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal, moveDealStage } from "../dist/application/crm/deal-use-cases.js";
import { acceptPublicProposal, applyProposalAcceptanceToDeal, createProposal, rejectPublicProposal, sendProposal } from "../dist/application/crm/proposal-use-cases.js";
import { inviteMember } from "../dist/application/identity/invite-use-cases.js";
import { createConnection, registerInboundMessage, sendInboxMessage } from "../dist/application/inbox/inbox-use-cases.js";
import { advanceOnboardingStep, completeOnboarding, saveCompanyStep, startOnboarding } from "../dist/application/onboarding/onboarding-use-cases.js";
import { createExecutionRun } from "../dist/application/execution/execution-engine.js";
import { createPlanningFromPreparedCommand } from "../dist/application/planning/planning-engine.js";
import { ensureRuntimeForPlanning } from "../dist/application/runtime/runtime-engine.js";
import { InMemoryPlanningRepository } from "../dist/infrastructure/storage/in-memory-planning-repository.js";
import { InMemoryExecutionTaskRepository } from "../dist/infrastructure/storage/in-memory-execution-task-repository.js";
import { InMemoryExecutionGraphRepository } from "../dist/infrastructure/storage/in-memory-execution-graph-repository.js";
import { InMemoryPlanningArtifactRepository } from "../dist/infrastructure/storage/in-memory-planning-artifact-repository.js";
import { InMemoryPlanningDecisionRepository } from "../dist/infrastructure/storage/in-memory-planning-decision-repository.js";
import { InMemoryRuntimeRepository } from "../dist/infrastructure/storage/in-memory-runtime-repository.js";
import { InMemoryExecutionRepository } from "../dist/infrastructure/storage/in-memory-execution-repository.js";
import { DeterministicExecutionTaskHandler } from "../dist/application/execution/deterministic-handlers.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Trial + Product Analytics — Fatia D (instrumentação). Foco: os pontos de instrumentação novos
 * espalhados por CRM/Convites/Conversas/Onboarding/Execução disparam o evento certo, e sobretudo
 * que os eventos "first_*" são de fato idempotentes por workspace SOB GATILHOS REAIS repetidos
 * (nunca "500 eventos pro mesmo marco", seção 8 do pedido) — não só a nível do mecanismo genérico
 * já coberto por `product-analytics.test.mjs`.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55993 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function analyticsDeps() {
  return { productEventRepository: new PostgresProductEventRepository(db.pool), enabled: true };
}

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

async function countEvents(eventName, workspaceId) {
  const result = await db.pool.query("select count(*)::int as c from product_events where event_name = $1 and workspace_id = $2", [eventName, workspaceId]);
  return result.rows[0].c;
}

// -----------------------------------------------------------------------------------------------
// CRM — Negócios/Propostas
// -----------------------------------------------------------------------------------------------

function dealDeps() {
  return {
    dealRepository: new PostgresDealRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    productAnalytics: analyticsDeps(),
  };
}

function proposalDeps() {
  return { proposalRepository: new PostgresProposalRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool), productAnalytics: analyticsDeps() };
}

function dealLinkDeps() {
  return {
    dealRepository: new PostgresDealRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    productAnalytics: analyticsDeps(),
  };
}

async function makePipelineWithStages(tenantId, workspaceId) {
  const deps = { pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) };
  const pipeline = await createPipeline(deps, { tenantId, workspaceId, name: "Vendas" });
  const novo = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Novo", position: 0 });
  const ganho = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Ganho", position: 1, isWon: true });
  return { pipeline, novo, ganho };
}

test("createDeal: first_deal_created registrado uma única vez por workspace, mesmo criando vários negócios", async () => {
  const tenantId = "tenant-ev-deal-1";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo } = await makePipelineWithStages(tenantId, workspace.id);
  const deps = dealDeps();

  await createDeal(deps, { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Negócio 1" });
  await createDeal(deps, { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Negócio 2" });

  assert.equal(await countEvents("first_deal_created", workspace.id), 1);
});

test("moveDealStage: first_deal_won registrado uma única vez, mesmo movendo dois negócios diferentes pra etapa de Ganho", async () => {
  const tenantId = "tenant-ev-deal-2";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo, ganho } = await makePipelineWithStages(tenantId, workspace.id);
  const deps = dealDeps();

  const dealA = await createDeal(deps, { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Negócio A" });
  const dealB = await createDeal(deps, { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Negócio B" });

  await moveDealStage(deps, { dealId: dealA.id, tenantId, workspaceId: workspace.id, targetStageId: ganho.id });
  await moveDealStage(deps, { dealId: dealB.id, tenantId, workspaceId: workspace.id, targetStageId: ganho.id });

  assert.equal(await countEvents("first_deal_won", workspace.id), 1);
});

test("applyProposalAcceptanceToDeal: também dispara first_deal_won (segundo caminho pra ganho, idempotente com moveDealStage)", async () => {
  const tenantId = "tenant-ev-deal-3";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo, ganho } = await makePipelineWithStages(tenantId, workspace.id);

  // Um negócio já ganho via moveDealStage (registra o primeiro first_deal_won)...
  const dealMoved = await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Movido manualmente" });
  await moveDealStage(dealDeps(), { dealId: dealMoved.id, tenantId, workspaceId: workspace.id, targetStageId: ganho.id });
  assert.equal(await countEvents("first_deal_won", workspace.id), 1);

  // ...e outro ganho pela ACEITAÇÃO DE PROPOSTA (bypassa moveDealStage inteiramente) nunca duplica.
  const dealViaProposal = await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Ganho via proposta" });
  const { proposal, rawToken } = await createProposal(proposalDeps(), { tenantId, workspaceId: workspace.id, dealId: dealViaProposal.id, title: "Proposta", items: [{ name: "Item", quantity: 1, unitPriceCents: 1000 }] });
  await sendProposal(proposalDeps(), { proposalId: proposal.id, tenantId, workspaceId: workspace.id });
  const accepted = await acceptPublicProposal(proposalDeps(), rawToken);
  await applyProposalAcceptanceToDeal(dealLinkDeps(), accepted);

  const dealAfter = await dealLinkDeps().dealRepository.getById(dealViaProposal.id);
  assert.ok(dealAfter.wonAt, "o segundo negócio realmente foi ganho (efeito de negócio não quebrou)");
  assert.equal(await countEvents("first_deal_won", workspace.id), 1, "first_deal_won continua contado uma única vez, mesmo com dois caminhos de ganho reais no mesmo workspace");
});

test("createProposal/sendProposal/acceptPublicProposal: first_proposal_* registrados uma vez cada; recusar NUNCA dispara first_proposal_accepted", async () => {
  const tenantId = "tenant-ev-proposal-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = proposalDeps();

  const { proposal: proposalA, rawToken: tokenA } = await createProposal(deps, { tenantId, workspaceId: workspace.id, title: "Proposta A", items: [{ name: "Item", quantity: 1, unitPriceCents: 1000 }] });
  await createProposal(deps, { tenantId, workspaceId: workspace.id, title: "Proposta B", items: [{ name: "Item", quantity: 1, unitPriceCents: 2000 }] });
  assert.equal(await countEvents("first_proposal_created", workspace.id), 1);

  await sendProposal(deps, { proposalId: proposalA.id, tenantId, workspaceId: workspace.id });
  assert.equal(await countEvents("first_proposal_sent", workspace.id), 1);

  const { proposal: proposalC, rawToken: tokenB } = await createProposal(deps, { tenantId, workspaceId: workspace.id, title: "Proposta C (recusada)", items: [{ name: "Item", quantity: 1, unitPriceCents: 500 }] });
  await sendProposal(deps, { proposalId: proposalC.id, tenantId, workspaceId: workspace.id });
  await rejectPublicProposal(deps, tokenB);
  assert.equal(await countEvents("first_proposal_accepted", workspace.id), 0, "recusar não é aceitar — nunca deve contar como o marco de aceite");

  await acceptPublicProposal(deps, tokenA);
  assert.equal(await countEvents("first_proposal_accepted", workspace.id), 1);
});

// -----------------------------------------------------------------------------------------------
// Convites — first_team_member_invited
// -----------------------------------------------------------------------------------------------

test("inviteMember: first_team_member_invited resolve workspaceId automaticamente quando não informado (fluxo Usuários), e é idempotente por workspace mesmo convidando pessoas diferentes", async () => {
  const tenantId = "tenant-ev-invite-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = {
    tenantMemberInviteRepository: new PostgresTenantMemberInviteRepository(db.pool),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool),
    userRepository: new PostgresUserRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool),
    productAnalytics: analyticsDeps(),
  };

  // Sem workspaceId explícito (como em `tenant-members.route.ts`) — resolve pelo único workspace do tenant.
  await inviteMember(deps, { tenantId, email: "convidado1@example.com", role: "editor", invitedByUserId: "user-admin" });
  assert.equal(await countEvents("first_team_member_invited", workspace.id), 1);

  // Um segundo convite (pessoa diferente) no MESMO workspace nunca duplica o marco.
  await inviteMember(deps, { tenantId, email: "convidado2@example.com", role: "viewer", invitedByUserId: "user-admin" });
  assert.equal(await countEvents("first_team_member_invited", workspace.id), 1);
});

test("inviteMember: workspaceId explícito (fluxo onboarding) usa o mesmo mecanismo de idempotência", async () => {
  const tenantId = "tenant-ev-invite-2";
  const workspace = await makeWorkspace(tenantId);
  const deps = {
    tenantMemberInviteRepository: new PostgresTenantMemberInviteRepository(db.pool),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool),
    userRepository: new PostgresUserRepository(db.pool),
    productAnalytics: analyticsDeps(),
  };

  await inviteMember(deps, { tenantId, email: "convidado@example.com", role: "editor", invitedByUserId: "user-admin", workspaceId: workspace.id });
  assert.equal(await countEvents("first_team_member_invited", workspace.id), 1);
});

// -----------------------------------------------------------------------------------------------
// Conversas — first_channel_connected / first_conversation_received / first_conversation_replied
// -----------------------------------------------------------------------------------------------

function inboxDeps() {
  return {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool),
    outboundQueue: { publish: async () => {} },
    provider: new FakeMessagingProvider(),
    productAnalytics: analyticsDeps(),
  };
}

test("createConnection: first_channel_connected registrado uma única vez, mesmo criando duas conexões no mesmo workspace", async () => {
  const tenantId = "tenant-ev-inbox-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = inboxDeps();

  await createConnection(deps, { tenantId, workspaceId: workspace.id, displayName: "Conexão 1" });
  await createConnection(deps, { tenantId, workspaceId: workspace.id, displayName: "Conexão 2" });

  assert.equal(await countEvents("first_channel_connected", workspace.id), 1);
});

test("registerInboundMessage: first_conversation_received só na conversa realmente NOVA — segunda mensagem do mesmo contato não duplica", async () => {
  const tenantId = "tenant-ev-inbox-2";
  const workspace = await makeWorkspace(tenantId);
  const deps = inboxDeps();
  const connection = await deps.connectionRepository.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });

  await registerInboundMessage(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: "+5511988887777", externalMessageId: "ext-1", type: "text", body: "Oi", occurredAt: new Date().toISOString() });
  assert.equal(await countEvents("first_conversation_received", workspace.id), 1);

  // Segunda mensagem do MESMO contato/conversa — não é uma conversa nova, não deve contar de novo.
  await registerInboundMessage(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: "+5511988887777", externalMessageId: "ext-2", type: "text", body: "Tudo bem?", occurredAt: new Date().toISOString() });
  assert.equal(await countEvents("first_conversation_received", workspace.id), 1);

  // Um SEGUNDO contato/conversa no mesmo workspace também não deve contar de novo (o marco é "a
  // primeira conversa do workspace", não "toda conversa nova").
  await registerInboundMessage(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: "+5511977776666", externalMessageId: "ext-3", type: "text", body: "Olá", occurredAt: new Date().toISOString() });
  assert.equal(await countEvents("first_conversation_received", workspace.id), 1);
});

test("sendInboxMessage: first_conversation_replied só conta resposta HUMANA — mensagem enviada pela IA nunca conta como a primeira resposta", async () => {
  const tenantId = "tenant-ev-inbox-3";
  const workspace = await makeWorkspace(tenantId);
  const deps = inboxDeps();
  const connection = await deps.connectionRepository.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const contact = await deps.contactRepository.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511911112222" });
  const conversation = await deps.conversationRepository.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });

  await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Resposta automática", sentByAi: true });
  assert.equal(await countEvents("first_conversation_replied", workspace.id), 0, "resposta da IA nunca é o marco de 'primeira resposta humana'");

  await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Oi, tudo bem?", sentByUserId: "user-1" });
  assert.equal(await countEvents("first_conversation_replied", workspace.id), 1);

  await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Mais uma mensagem", sentByUserId: "user-1" });
  assert.equal(await countEvents("first_conversation_replied", workspace.id), 1);
});

// -----------------------------------------------------------------------------------------------
// Onboarding — onboarding_started / onboarding_step_completed / onboarding_completed
// -----------------------------------------------------------------------------------------------

function onboardingAnalyticsDeps({ inboxModuleEnabled = true } = {}) {
  return {
    workspaceOnboardingRepository: new PostgresWorkspaceOnboardingRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool),
    entitlementDeps: {
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
    },
    inviteDeps: {
      tenantMemberInviteRepository: new PostgresTenantMemberInviteRepository(db.pool),
      membershipRepository: new PostgresTenantMembershipRepository(db.pool),
      userRepository: new PostgresUserRepository(db.pool),
    },
    inboxDeps: {
      connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
      contactRepository: new PostgresInboxContactRepository(db.pool),
      conversationRepository: new PostgresInboxConversationRepository(db.pool),
      conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
      messageRepository: new PostgresInboxMessageRepository(db.pool),
      workspaceRepository: new PostgresWorkspaceRepository(db.pool),
      outboundQueue: { publish: async () => {} },
      provider: new FakeMessagingProvider(),
    },
    inboxModuleEnabled,
    productAnalytics: analyticsDeps(),
  };
}

async function makeTenantWithWorkspace(tenantId) {
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: `Workspace de ${tenantId}` });
  return { workspace };
}

test("onboarding: onboarding_started/onboarding_step_completed/onboarding_completed cada um exatamente uma vez, mesmo com wizard reaberto/reload", async () => {
  const tenantId = "tenant-ev-onb-1";
  const { workspace } = await makeTenantWithWorkspace(tenantId);
  const deps = onboardingAnalyticsDeps();

  await startOnboarding(deps, { tenantId, workspaceId: workspace.id });
  await startOnboarding(deps, { tenantId, workspaceId: workspace.id }); // reload do wizard
  assert.equal(await countEvents("onboarding_started", workspace.id), 1);

  await saveCompanyStep(deps, { tenantId, workspaceId: workspace.id, segment: "moda" });
  await saveCompanyStep(deps, { tenantId, workspaceId: workspace.id, segment: "moda" }); // reload da mesma etapa
  await advanceOnboardingStep(deps, { tenantId, workspaceId: workspace.id, step: "team", skipped: true });
  await advanceOnboardingStep(deps, { tenantId, workspaceId: workspace.id, step: "channel", skipped: true });

  const stepEvents = await db.pool.query("select properties from product_events where event_name = 'onboarding_step_completed' and workspace_id = $1", [workspace.id]);
  // "company" concluído de verdade (1x, nunca 2x pelo reload); "team"/"channel" foram PULADOS
  // (skipped: true nunca conta como concluído — mesma distinção que o checklist da Home já fazia).
  assert.deepEqual(stepEvents.rows.map((row) => row.properties.step), ["company"]);

  await completeOnboarding(deps, { tenantId, workspaceId: workspace.id });
  await completeOnboarding(deps, { tenantId, workspaceId: workspace.id }); // completar de novo
  assert.equal(await countEvents("onboarding_completed", workspace.id), 1);
});

// -----------------------------------------------------------------------------------------------
// Execução — first_content_created
// -----------------------------------------------------------------------------------------------

function executionDeps(productEventRepository) {
  const shared = {
    planningRepository: new InMemoryPlanningRepository(),
    executionTaskRepository: new InMemoryExecutionTaskRepository(),
    executionGraphRepository: new InMemoryExecutionGraphRepository(),
    artifactRepository: new InMemoryPlanningArtifactRepository(),
    decisionRepository: new InMemoryPlanningDecisionRepository(),
    runtimeRepository: new InMemoryRuntimeRepository({ now: () => new Date("2026-01-01T00:00:00.000Z") }),
    executionRepository: new InMemoryExecutionRepository({ now: () => new Date("2026-01-01T00:00:00.000Z") }),
  };
  return {
    shared,
    planningDeps: { ...shared, idGenerator: () => `planning-id-${nextId("p")}`, now: () => new Date("2026-01-01T00:00:00.000Z") },
    runtimeDeps: { ...shared, idGenerator: () => `runtime-id-${nextId("r")}`, now: () => new Date("2026-01-01T00:00:00.000Z") },
    executionDeps: {
      ...shared,
      handlers: [new DeterministicExecutionTaskHandler()],
      idGenerator: () => `execution-id-${nextId("e")}`,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      sleep: async () => undefined,
      productAnalytics: { productEventRepository, enabled: true },
    },
  };
}

function preparedCommandFixture(overrides = {}) {
  return {
    id: "command-ev-1",
    tenantId: "tenant-ev-exec-1",
    workspaceId: "workspace-ev-exec-1",
    conversationId: "conversation-1",
    briefingId: "briefing-1",
    briefingRevision: 1,
    type: "campaign_creation",
    intent: "create_campaign",
    validatedInputs: { channel: "instagram", contentFormat: "carousel" },
    sourceReferences: {},
    unresolvedOptionalFields: [],
    status: "prepared",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("createExecutionRun: first_content_created idempotente sob retry da MESMA idempotencyKey (nunca duplica)", async () => {
  const workspaceId = "workspace-ev-exec-1";
  const tenantId = "tenant-ev-exec-1";
  // Fake mínimo em memória — só o suficiente pra `recordFirstEvent` (idempotência por
  // workspace+evento); reusa o MESMO desenho do repositório real, sem depender de Postgres pra um
  // teste que já é 100% in-memory no resto (mesmo estilo de `execution-engine.test.mjs`).
  const seen = new Set();
  const recorded = [];
  const productEventRepository = {
    async markFirstOccurrence({ workspaceId, eventName }) {
      const key = `${workspaceId}:${eventName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    async record(input) {
      recorded.push(input);
    },
  };
  const deps = executionDeps(productEventRepository);
  const planning = await createPlanningFromPreparedCommand(deps.planningDeps, preparedCommandFixture());
  const runtime = await ensureRuntimeForPlanning(deps.runtimeDeps, planning);

  const first = await createExecutionRun(deps.executionDeps, { tenantId, workspaceId, runtimePlanId: runtime.id, idempotencyKey: "idem-ev-1" });
  const retry = await createExecutionRun(deps.executionDeps, { tenantId, workspaceId, runtimePlanId: runtime.id, idempotencyKey: "idem-ev-1" });

  assert.equal(first.id, retry.id, "retry da mesma idempotencyKey devolve o MESMO run, nunca cria um segundo");
  assert.equal(recorded.filter((event) => event.eventName === "first_content_created").length, 1);
});
