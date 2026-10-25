import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-task-repository.js";
import { PostgresProposalRepository } from "../dist/infrastructure/storage/postgres/postgres-proposal-repository.js";
import { PostgresInboxAttendanceRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-attendance-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMetricsRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-metrics-repository.js";
import { crmScope, registerCrmAccessGuards } from "../dist/interfaces/api/http/crm-access.js";
import { resolveDealScope } from "../dist/application/sales/sales-context.js";
import { resolveReportSubject } from "../dist/application/sales/sales-performance-use-cases.js";
import { effectivePermissions } from "../dist/domain/identity/identity.model.js";
import { isConversationVisible } from "../dist/application/ports/inbox-conversation-repository.port.js";
import { periodRange } from "../dist/domain/sales/goals.js";
import { computeAttendanceMetrics, resolveDashboardPeriod } from "../dist/domain/dashboard/dashboard-metrics.js";
import { filterCommercialResponse } from "../dist/interfaces/api/http/commercial-response-visibility.js";
import { registerWorkspaceTenantGuard } from "../dist/interfaces/api/http/workspace-tenant-guard.js";
import { defaultCommercialSettings, resolveVisibility } from "../dist/application/sales/sales-context.js";
import { canDeliverScopedInboxNotification, resolveConversationVisibility } from "../dist/interfaces/api/routes/v1/inbox.route.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresCommercialMetricsRepository } from "../dist/infrastructure/storage/postgres/postgres-commercial-metrics-repository.js";
import { AccessResolver } from "../dist/application/identity/access-resolver.js";

let db, deps, ctx, manager, shared, teamA, teamB, entities;
before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, join(process.cwd(), "db/migrations"));
  deps = {
    teamRepository: new PostgresTeamRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool),
    teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool),
    dealRepository: new PostgresDealRepository(db.pool),
    contactRepository: new PostgresContactRepository(db.pool),
    taskRepository: new PostgresTaskRepository(db.pool),
    proposalRepository: new PostgresProposalRepository(db.pool),
    salesConfigRepository: { getSettings: async () => ({ dealVisibility: "all" }) },
  };
  const workspace = await deps.workspaceRepository.create({ tenantId: "audit", name: "Review" });
  ctx = { tenantId: "audit", workspaceId: workspace.id };
  const users = new PostgresUserRepository(db.pool);
  manager = await users.create({ email: "manager@review.test", name: "Manager", passwordHash: "x" });
  shared = await users.create({ email: "shared@review.test", name: "Shared", passwordHash: "x" });
  for (const user of [manager, shared]) await deps.membershipRepository.create({ userId: user.id, tenantId: ctx.tenantId, role: user === manager ? "admin" : "editor" });
  const teams = new PostgresTeamRepository(db.pool);
  teamA = await teams.create({ ...ctx, name: "A" });
  teamB = await teams.create({ ...ctx, name: "B" });
  for (const [user, team] of [[manager, teamA], [shared, teamA], [shared, teamB]]) await deps.teamMembershipRepository.add({ teamId: team.id, userId: user.id, role: user === manager ? "admin" : "editor" });
  const pipeline = await new PostgresPipelineRepository(db.pool).create({ ...ctx, name: "Pipeline" });
  const stage = await new PostgresPipelineStageRepository(db.pool).create({ ...ctx, pipelineId: pipeline.id, name: "Open", position: 0 });
  entities = {};
  for (const [key, team] of [["a", teamA], ["b", teamB]]) {
    const ownership = { ownerUserId: shared.id, teamId: team.id };
    const contact = await deps.contactRepository.create({ ...ctx, ...ownership, name: key });
    const deal = await deps.dealRepository.create({ ...ctx, ...ownership, pipelineId: pipeline.id, stageId: stage.id, contactId: contact.id, title: key });
    const task = await deps.taskRepository.create({ ...ctx, ...ownership, contactId: contact.id, dealId: deal.id, type: "follow_up", title: key });
    const proposal = await deps.proposalRepository.create({ ...ctx, dealId: deal.id, contactId: contact.id, title: key, items: [], totalCents: 100, publicTokenHash: `review-${key}`, createdByUserId: shared.id });
    entities[key] = { contacts: contact, deals: deal, tasks: task, proposals: proposal };
  }
});
after(async () => db?.stop());
const actor = () => ({ userId: manager.id, tenantId: ctx.tenantId, role: "admin", sessionId: "s", permissions: effectivePermissions("admin") });

test("legacy all setting cannot override individual permissions; team membership is tenant bound", async () => {
  const own = { ...actor(), role: "editor", permissions: effectivePermissions("editor") };
  assert.deepEqual(await resolveDealScope(deps, own, ctx.workspaceId), { ownerUserIdsIn: [manager.id] });
  const foreignWorkspace = await deps.workspaceRepository.create({ tenantId: "foreign", name: "Foreign" });
  const foreignTeam = await new PostgresTeamRepository(db.pool).create({ tenantId: "foreign", workspaceId: foreignWorkspace.id, name: "Foreign" });
  await deps.teamMembershipRepository.add({ teamId: foreignTeam.id, userId: manager.id, role: "admin" });
  assert.deepEqual((await deps.teamMembershipRepository.listByUser(manager.id, ctx.tenantId)).map(m => m.teamId), [teamA.id]);
});

test("collections: shared colleague does not expose the other team's deals, contacts, tasks or proposals", async () => {
  const scope = await crmScope(deps, actor());
  for (const [kind, repository] of [["deals", deps.dealRepository], ["contacts", deps.contactRepository], ["tasks", deps.taskRepository], ["proposals", deps.proposalRepository]]) {
    const records = await repository.listByWorkspace({ ...ctx, ...scope });
    assert.deepEqual(records.map(r => r.id), [entities.a[kind].id], kind);
  }
  const report = await resolveReportSubject(deps, actor(), { userId: shared.id });
  assert.deepEqual(report.teamIds, [teamA.id]);
});

test("direct URLs and related IDs: history, delivery, tracking, ownership and tenant are guarded", async () => {
  const app = Fastify();
  app.addHook("preValidation", async request => { request.zunoContext = { principal: actor() }; });
  registerCrmAccessGuards(app, deps);
  for (const kind of ["contacts", "tasks", "proposals", "deals"]) {
    app.get(`/${kind}/:id/history`, async () => ({ ok: true }));
    app.post(`/${kind}/:id/action`, async () => ({ ok: true }));
    app.post(`/${kind}`, async () => ({ ok: true }));
  }
  try {
    for (const kind of ["contacts", "tasks", "proposals", "deals"]) {
      assert.equal((await app.inject(`/${kind}/${entities.a[kind].id}/history?workspaceId=${ctx.workspaceId}`)).statusCode, 200, kind);
      assert.equal((await app.inject(`/${kind}/${entities.b[kind].id}/history?workspaceId=${ctx.workspaceId}`)).statusCode, 404, kind);
      assert.equal((await app.inject({ method: "POST", url: `/${kind}/${entities.a[kind].id}/action`, payload: { workspaceId: ctx.workspaceId, dealId: entities.b.deals.id } })).statusCode, 404, kind);
      assert.equal((await app.inject({ method: "POST", url: `/${kind}`, payload: { workspaceId: "foreign", ownerUserId: manager.id } })).statusCode, 404, kind);
    }
  } finally { await app.close(); }
});

test("inbox visibility: a colleague in two teams never widens the manager's scope", () => {
  const visibility = { ownUserId: manager.id, userIds: [manager.id, shared.id], teamIds: [teamA.id], queueTeamIds: [teamA.id] };
  assert.equal(isConversationVisible({ assignedUserId: shared.id, currentTeamId: teamB.id }, visibility), false);
  assert.equal(isConversationVisible({ assignedUserId: shared.id, currentTeamId: teamA.id }, visibility), true);
  assert.equal(isConversationVisible({ assignedUserId: manager.id, currentTeamId: teamB.id }, visibility), true);
});

test("company timezone: Dashboard and goals agree near midnight and invalid dates are rejected", () => {
  const period = resolveDashboardPeriod({ period: "this_month", timeZone: "America/Sao_Paulo", now: new Date("2026-11-01T02:30:00Z") });
  const goal = periodRange("monthly", "2026-10-01", "America/Sao_Paulo");
  assert.equal(period.from, goal.from);
  assert.equal(goal.to, "2026-11-01T03:00:00.000Z");
  assert.throws(() => periodRange("monthly", "2026-13-01", "UTC"), /INVALID/);
  assert.throws(() => resolveDashboardPeriod({ period: "custom", from: "2026-02-31", to: "2026-03-01", timeZone: "UTC" }), /INVALID/);
});

test("backlog belongs to the current assignee; historical participation and invalid CSAT do not inflate it", () => {
  const metrics = computeAttendanceMetrics({
    attendances: [{ id: "open", status: "open", openedAt: "2026-10-01T10:00:00.000Z", sla: {}, reopenedCount: 0 }, { id: "closed", status: "closed", openedAt: "2026-10-01T10:00:00.000Z", closedAt: "2026-10-01T11:00:00.000Z", sla: {}, reopenedCount: 0, csatStatus: "sent", csatScore: 99 }],
    assignments: [{ attendanceId: "open", userId: "a", startedAt: "2026-10-01T10:00:00.000Z", endedAt: "2026-10-01T10:20:00.000Z" }],
    allAssignments: [{ attendanceId: "open", userId: "b", startedAt: "2026-10-01T10:20:00.000Z" }],
    currentUserIds: ["a"], phaseTimes: [], from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z", now: "2026-10-01T12:00:00.000Z",
  });
  assert.equal(metrics.backlog.total, 0);
  assert.equal(metrics.csat.answered, 0);
});

test("repeat attendances: resolution uses closure and FRT resets on transfer; CSAT cannot be overwritten or reused", async () => {
  const connection = await new PostgresMessagingConnectionRepository(db.pool).create({ ...ctx, provider: "wuzapi", displayName: "Review" });
  const conversations = new PostgresInboxConversationRepository(db.pool);
  const conversation = await conversations.findOrCreate({ ...ctx, connectionId: connection.id, chatType: "direct", externalChatId: "+5511900001234" });
  const repo = new PostgresInboxAttendanceRepository(db.pool);
  const open = async at => (await repo.openIfNone({ ...ctx, conversationId: conversation.id, connectionId: connection.id, openedAt: at, openedBy: manager.id, openReason: "inbound_message" })).attendance;
  const first = await open("2026-10-01T10:00:00.000Z");
  await repo.changeResponsible({ attendanceId: first.id, toUserId: manager.id, at: "2026-10-01T10:00:00.000Z", source: "manual", assignedBy: manager.id, endReason: "transferred" });
  await repo.recordFirstResponse({ attendanceId: first.id, userId: manager.id, messageId: "first-response-a", at: "2026-10-01T10:05:00.000Z" });
  await repo.changeResponsible({ attendanceId: first.id, toUserId: shared.id, at: "2026-10-01T10:20:00.000Z", source: "manual", assignedBy: manager.id, endReason: "transferred" });
  await repo.recordFirstResponse({ attendanceId: first.id, userId: shared.id, messageId: "first-response-b", at: "2026-10-01T10:22:00.000Z" });
  await repo.close(first.id, { closedAt: "2026-10-01T11:00:00.000Z", closedBy: shared.id });
  await repo.setCsat(first.id, { status: "sent", sentAt: "2026-10-01T11:00:00.000Z" });
  await repo.recordCsatAnswer(first.id, { score: 5, answeredAt: "2026-10-01T11:01:00.000Z" });
  await repo.recordCsatAnswer(first.id, { score: 1, answeredAt: "2026-10-01T11:02:00.000Z" });
  const second = await open("2026-10-01T12:00:00.000Z");
  await repo.close(second.id, { closedAt: "2026-10-01T12:30:00.000Z", closedBy: manager.id });
  await repo.setCsat(second.id, { status: "sent", sentAt: "2026-10-01T12:30:00.000Z" });
  await repo.recordCsatAnswer(second.id, { score: 3, answeredAt: "2026-10-01T12:31:00.000Z" });
  const metrics = await new PostgresInboxMetricsRepository(db.pool).getMetrics({ ...ctx, dateFrom: "2026-10-01T00:00:00Z", dateTo: "2026-10-01T23:59:59Z" });
  assert.equal(metrics.receivedCount, 2);
  assert.equal(metrics.resolvedCount, 2);
  assert.equal(metrics.avgHandleTimeSeconds, 2700);
  assert.equal(metrics.avgFirstResponseSeconds, 210);
  assert.equal(metrics.csatAverage, 4);
  assert.equal(metrics.csatResponses, 2);
  await repo.reopen(second.id, "2026-10-01T13:00:00.000Z");
  await repo.close(second.id, { closedAt: "2026-10-01T14:00:00.000Z", closedBy: manager.id });
  await repo.setCsat(second.id, { status: "sent", sentAt: "2026-10-01T14:00:00.000Z" });
  assert.equal((await repo.getById(second.id)).csatScore, undefined);
});

test("routing never assigns disabled or removed tenant members", async () => {
  const teams = new PostgresTeamRepository(db.pool);
  await deps.membershipRepository.setStatus(shared.id, ctx.tenantId, "disabled");
  assert.equal((await teams.selectNextMemberForLevel(teamA.id, "N1")).userId, manager.id);
  assert.equal(await teams.selectNextMemberForLevel(teamB.id, "N1"), undefined);
  await deps.membershipRepository.remove(shared.id, ctx.tenantId);
  assert.equal(await teams.selectNextMemberForLevel(teamB.id, "N1"), undefined);
});

test("an unowned contact created by WhatsApp remains accessible through the authorized conversation", async () => {
  const contact = await deps.contactRepository.create({ ...ctx, name: "Inbound contact" });
  const inboxContactRepo = new PostgresInboxContactRepository(db.pool);
  const inboxContact = await inboxContactRepo.upsertByPhone({ ...ctx, phoneNormalized: "+5511900011111", name: "Inbound" });
  await inboxContactRepo.linkCrmContact(inboxContact.id, contact.id);
  const connection = await new PostgresMessagingConnectionRepository(db.pool).create({ ...ctx, provider: "wuzapi", displayName: "Bridge" });
  const conversationRepository = new PostgresInboxConversationRepository(db.pool);
  const conversation = await conversationRepository.findOrCreate({ ...ctx, connectionId: connection.id, contactId: inboxContact.id, externalChatId: "+5511900011111", chatType: "direct" });
  await conversationRepository.assign(conversation.id, manager.id);
  const scope = await crmScope(deps, actor(), true);
  const inboxVisibility = await resolveConversationVisibility(deps, actor());
  const contacts = await deps.contactRepository.listByWorkspace({ ...ctx, ...scope, inboxVisibility });
  assert.ok(contacts.some(c => c.id === contact.id));
  const app = Fastify();
  app.addHook("preValidation", async request => { request.zunoContext = { principal: actor() }; });
  registerCrmAccessGuards(app, { ...deps, inboxConversationRepository: conversationRepository });
  app.get("/contacts/:id", async () => ({ ok: true }));
  try { assert.equal((await app.inject(`/contacts/${contact.id}?workspaceId=${ctx.workspaceId}`)).statusCode, 200); }
  finally { await app.close(); }
});

test("workspace guard blocks foreign writes outside CRM too, including mismatched body and query", async () => {
  const app = Fastify();
  app.addHook("preValidation", async request => { request.zunoContext = { principal: actor() }; });
  registerWorkspaceTenantGuard(app, deps.workspaceRepository);
  app.post("/sales-goals", async () => ({ ok: true }));
  try {
    assert.equal((await app.inject({ method: "POST", url: "/sales-goals", payload: { workspaceId: ctx.workspaceId } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `/sales-goals?workspaceId=${ctx.workspaceId}`, payload: { workspaceId: "foreign" } })).statusCode, 404);
  } finally { await app.close(); }
});

test("commercial history snapshots honor cost and margin revocations even when seller settings allow them", () => {
  const settings = { ...defaultCommercialSettings(ctx.tenantId, ctx.workspaceId), sellersCanViewCost: true, sellersCanViewMargin: true };
  const seller = { ...actor(), role: "editor", permissions: effectivePermissions("editor"), permissionRevokes: ["product:view_cost", "deal:view_margin"] };
  const visibility = resolveVisibility(seller, settings);
  assert.equal(visibility.canViewCost, false);
  assert.equal(visibility.canViewMargin, false);
  const response = filterCommercialResponse({ valueCents: 100, payload: { before: { unitCostCentsSnapshot: 20, finalGrossProfitCents: 80 }, after: [{ subtotalCostCents: 30, grossMarginBp: 7000, quantity: 1 }] } }, visibility);
  assert.deepEqual(response, { valueCents: 100, payload: { before: {}, after: [{ quantity: 1 }] } });
});

test("migration preserves the last legacy closure/CSAT and repairs only tenants missing an administrator", async () => {
  const connection = await new PostgresMessagingConnectionRepository(db.pool).create({ ...ctx, provider: "wuzapi", displayName: "Legacy" });
  const conversations = new PostgresInboxConversationRepository(db.pool);
  const conversation = await conversations.findOrCreate({ ...ctx, connectionId: connection.id, chatType: "direct", externalChatId: "+5511900099999" });
  await db.pool.query("update inbox_conversations set status='resolved', closed_at='2026-09-01T12:00Z', closed_by=$2, csat_status='answered', csat_requested_at='2026-09-01T12:00Z', csat_score=5, csat_answered_at='2026-09-01T12:01Z' where id=$1", [conversation.id, manager.id]);
  await db.pool.query("update tenant_members set permission_revokes=array['tenant_member:manage'] where tenant_id=$1 and user_id=$2", [ctx.tenantId, manager.id]);
  const migration = await readFile(join(process.cwd(), "db/migrations/0175_integration_review.sql"), "utf8");
  await db.pool.query(migration);
  await db.pool.query(migration);
  const rows = await db.pool.query("select * from inbox_attendances where conversation_id=$1", [conversation.id]);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].csat_score, 5);
  assert.equal(rows.rows[0].csat_status, "sent");
  const administrator = await deps.membershipRepository.getByUserAndTenant(manager.id, ctx.tenantId);
  assert.equal(administrator.role, "owner");
  assert.equal(administrator.isAccountOwner, true);
  assert.ok(effectivePermissions(administrator.role, administrator.permissionGrants, administrator.permissionRevokes).includes("tenant_member:manage"));
  const metrics = await new PostgresInboxMetricsRepository(db.pool).getMetrics({ ...ctx, dateFrom: "2026-09-01T00:00Z", dateTo: "2026-09-01T23:59Z" });
  assert.equal(metrics.resolvedCount, 1);
  assert.equal(metrics.csatAverage, 5);
  assert.equal(metrics.avgHandleTimeSeconds, undefined, "legacy opening time is unknown, never fabricate a TMR");
});

test("legacy commercial report obeys team scope, credited ownership, final value and reopening", async () => {
  for (const [key, amount, owner, team] of [["a", 123456, manager, teamA], ["b", 990000, shared, teamB]]) {
    await db.pool.query("update deals set status='won', won_at='2026-10-01T12:00Z', closed_at='2026-10-01T12:00Z', created_at='2026-09-01T12:00Z', final_value_cents=$2, credited_owner_user_id=$3, credited_team_id=$4 where id=$1", [entities[key].deals.id, amount, owner.id, team.id]);
    await db.pool.query("update proposals set status='sent', sent_at='2026-10-01T12:00Z' where id=$1", [entities[key].proposals.id]);
  }
  const repository = new PostgresCommercialMetricsRepository(db.pool);
  const scope = { ...ctx, ...await crmScope(deps, actor()) };
  let metrics = await repository.getMetrics(scope);
  assert.equal(metrics.wonCount, 1);
  assert.equal(metrics.wonValueCents, 123456);
  assert.equal(metrics.proposalsSentCount, 1);
  const own = await repository.getMetrics({ ...ctx, ownerUserIdsIn: [manager.id], ownerUserId: manager.id });
  assert.equal(own.wonCount, 1, "historical credit survives transfer of the current owner");
  await db.pool.query("update deals set status='open', won_at=null, closed_at=null where id=$1", [entities.a.deals.id]);
  assert.equal((await repository.getMetrics(scope)).wonCount, 0);
  await db.pool.query("update deals set status='won', won_at='2026-10-02T12:00Z', closed_at='2026-10-02T12:00Z', final_value_cents=110000 where id=$1", [entities.a.deals.id]);
  metrics = await repository.getMetrics(scope);
  assert.equal(metrics.wonCount, 1);
  assert.equal(metrics.wonValueCents, 110000);
});

test("realtime notifications obey current conversation/team scope and disabled memberships", async () => {
  const connection = await new PostgresMessagingConnectionRepository(db.pool).create({ ...ctx, provider: "wuzapi", displayName: "Stream" });
  const repository = new PostgresInboxConversationRepository(db.pool);
  const streamDeps = { conversationRepository: repository, teamMembershipRepository: deps.teamMembershipRepository };
  for (const [key, team] of [["allowed", teamA], ["forbidden", teamB]]) {
    const conversation = await repository.findOrCreate({ ...ctx, connectionId: connection.id, chatType: "direct", externalChatId: key });
    await repository.assign(conversation.id, shared.id);
    await repository.setTeam(conversation.id, team.id);
    assert.equal(await canDeliverScopedInboxNotification(streamDeps, actor(), ctx.workspaceId, { ...ctx, conversationId: conversation.id }), key === "allowed");
  }
  const disabled = { ...streamDeps, membershipRepository: { getByUserAndTenant: async () => ({ role: "owner", status: "disabled" }) } };
  assert.equal(await canDeliverScopedInboxNotification(disabled, actor(), ctx.workspaceId, ctx), false);
});

test("disabled access is denied on the next request without relying on cache invalidation", async () => {
  const user = await new PostgresUserRepository(db.pool).create({ email: "disable@review.test", name: "Disabled", passwordHash: "x" });
  await deps.membershipRepository.create({ userId: user.id, tenantId: ctx.tenantId, role: "editor" });
  const resolver = new AccessResolver(deps.membershipRepository);
  const principal = { ...actor(), userId: user.id, role: "editor" };
  assert.ok(await resolver.resolve(principal));
  await deps.membershipRepository.setStatus(user.id, ctx.tenantId, "disabled");
  assert.equal(await resolver.resolve(principal), undefined);
});

test("a manager retains their own operational opportunities without gaining access to colleagues in that team", async () => {
  await deps.teamMembershipRepository.add({ teamId: teamB.id, userId: manager.id, role: "editor" });
  const own = await deps.dealRepository.create({ ...ctx, pipelineId: entities.b.deals.pipelineId, stageId: entities.b.deals.stageId, title: "Own operational sale", ownerUserId: manager.id, teamId: teamB.id });
  const scope = await crmScope(deps, actor());
  assert.deepEqual(scope.teamIdsIn, [teamA.id]);
  const records = await deps.dealRepository.listByWorkspace({ ...ctx, ...scope });
  assert.ok(records.some(record => record.id === own.id));
  assert.ok(!records.some(record => record.id === entities.b.deals.id));
});
