import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxAttendanceRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-attendance-repository.js";
import { PostgresInboxClosureCatalogRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-closure-catalog-repository.js";
import { PostgresDashboardRepository } from "../dist/infrastructure/storage/postgres/postgres-dashboard-repository.js";
import { assignConversation, closeConversation, registerInboundMessage, sendInboxMessage, transferConversation } from "../dist/application/inbox/inbox-use-cases.js";
import { listClosureTypes } from "../dist/application/inbox/attendance-tracking.js";
import { getDashboard, resolveSlaTargets } from "../dist/application/dashboard/dashboard-use-cases.js";
import { computeAttendanceMetrics, resolveDashboardPeriod, slaState } from "../dist/domain/dashboard/dashboard-metrics.js";
import { effectivePermissions } from "../dist/domain/identity/identity.model.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Dashboard principal: fórmulas centralizadas sobre fatos estruturados e escopo no backend. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-dash-${++counter}`;
const at = (time) => `2026-10-20T${time}:00.000Z`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

test("FRT por ciclo: João 4 min, Maria 3 min (relógio dela começa na transferência); TMR global separado da posse", () => {
  const attendance = { id: "a1", conversationId: "c1", connectionId: "k", status: "closed", openedAt: at("10:00"), closedAt: at("10:40"), closedBy: "maria", firstResponseAt: at("10:04"), reopenedCount: 0, csatStatus: "sent", csatScore: 5, closureTypeName: "Resolvido", closureSubtypeName: "Dúvida", sla: { firstResponseSeconds: 300, resolutionSeconds: 3600 } };
  const cycles = [
    { attendanceId: "a1", userId: "joao", startedAt: at("10:00"), firstResponseAt: at("10:04"), endedAt: at("10:20"), endReason: "transferred" },
    { attendanceId: "a1", userId: "maria", startedAt: at("10:20"), firstResponseAt: at("10:23"), endedAt: at("10:40"), endReason: "attendance_closed" },
  ];
  const metrics = computeAttendanceMetrics({ attendances: [attendance], assignments: cycles, allAssignments: cycles, phaseTimes: [], from: at("00:00"), to: "2026-10-21T00:00:00.000Z", now: at("12:00") });
  assert.equal(metrics.frt.value, 210, "média de 4 min e 3 min, nunca 23 min para Maria");
  assert.equal(metrics.frt.sample, 2);
  assert.equal(metrics.frtAttendance.value, 240);
  assert.equal(metrics.tmr.value, 2400, "TMR global = 40 min");
  assert.equal(metrics.holding.value, 1200, "posse média por ciclo: João 20 min, Maria 20 min");
  assert.equal(metrics.sla.firstResponse.met, 2, "SLA individual de 5 min cumprido pelos dois");
  assert.equal(metrics.sla.resolution.met, 1);
  assert.equal(metrics.transfers.count, 1);
  assert.equal(metrics.transfers.rateBp, 10000);
  assert.equal(metrics.volume.finalized, 1, "conta uma vez, mesmo com dois responsáveis");
  assert.deepEqual(metrics.csat.average, { value: 5, sample: 1 });
  assert.equal(metrics.closures[0].shareBp, 10000);
});

test("SLA: perto de vencer, vencido e backlog classificado com os estados existentes", () => {
  assert.equal(slaState(250, 300, false), "near");
  assert.equal(slaState(301, 300, false), "breached");
  assert.equal(slaState(299, 300, true), "met");
  const open = (id, patch = {}) => ({ id, conversationId: id, connectionId: "k", status: "open", openedAt: at("11:00"), reopenedCount: 0, sla: { firstResponseSeconds: 300 }, ...patch });
  const attendances = [open("q"), open("f"), open("w", { lastMessageDirection: "inbound" }), open("c", { lastMessageDirection: "outbound" }), open("p", { waitingPhase: true, lastMessageDirection: "inbound" })];
  const cycles = [
    { attendanceId: "f", userId: "u", startedAt: at("11:50") },
    { attendanceId: "w", userId: "u", startedAt: at("11:00"), firstResponseAt: at("11:01") },
    { attendanceId: "c", userId: "u", startedAt: at("11:00"), firstResponseAt: at("11:01") },
    { attendanceId: "p", userId: "u", startedAt: at("11:00"), firstResponseAt: at("11:01") },
  ];
  const metrics = computeAttendanceMetrics({ attendances, assignments: cycles, allAssignments: cycles, phaseTimes: [], from: at("00:00"), to: "2026-10-21T00:00:00.000Z", now: at("11:56") });
  assert.deepEqual(metrics.backlog, { total: 5, queue: 1, awaitingFirstResponse: 1, awaitingAgent: 1, awaitingCustomer: 2, slaBreached: 1 });
  assert.equal(metrics.sla.openBreached, 1, "6 min sem responder, com prazo de 5");
  assert.deepEqual(resolveSlaTargets([
    { scopeType: "workspace", firstResponseSeconds: 600, resolutionSeconds: 7200 },
    { scopeType: "team", scopeId: "t1", firstResponseSeconds: 300 },
    { scopeType: "connection", scopeId: "k1", resolutionSeconds: 3600 },
  ], { connectionId: "k1", teamId: "t1" }), { firstResponseSeconds: 300, resolutionSeconds: 3600 }, "canal > equipe > empresa, campo a campo");
});

test("período no fuso da empresa: 'hoje' em São Paulo perto da meia-noite UTC", () => {
  const period = resolveDashboardPeriod({ period: "today", timeZone: "America/Sao_Paulo", now: new Date("2026-10-21T01:30:00Z") });
  assert.equal(period.from, "2026-10-20T03:00:00.000Z", "ainda é dia 20 em São Paulo");
  assert.equal(period.to, "2026-10-21T03:00:00.000Z");
  const lastMonth = resolveDashboardPeriod({ period: "last_month", timeZone: "America/Sao_Paulo", now: new Date("2026-10-21T12:00:00Z") });
  assert.equal(lastMonth.from, "2026-09-01T03:00:00.000Z");
  assert.equal(lastMonth.monthStart, "2026-09-01");
  assert.throws(() => resolveDashboardPeriod({ period: "custom", from: "2026-10-10", to: "2026-10-01", timeZone: "UTC" }), /DASHBOARD_PERIOD_INVALID/);
});

test("escopo: atendente vê só os próprios números; gerente vê a própria equipe e não a outra; Administrador vê a empresa", async () => {
  const tenantId = "tenant-dash-1";
  const users = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  const workspaceRepository = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const inbox = {
    workspaceRepository,
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    attendanceRepository: new PostgresInboxAttendanceRepository(db.pool),
    closureCatalogRepository: new PostgresInboxClosureCatalogRepository(db.pool),
    outboundQueue: { publish: async () => {} },
    providers: { wuzapi: {} },
  };
  const workspace = await workspaceRepository.create({ tenantId, name: "W" });
  const ctx = { tenantId, workspaceId: workspace.id };
  const person = async (role) => {
    const user = await users.create({ email: `${nextId("p")}@x.com`, passwordHash: "x", name: role });
    await membershipRepository.create({ userId: user.id, tenantId, role });
    return user.id;
  };
  const ownerId = await person("owner");
  const gerenteId = await person("admin");
  const carlosId = await person("editor");
  const anaId = await person("editor");
  const comercial = await teamRepository.create({ ...ctx, name: "Comercial" });
  const suporte = await teamRepository.create({ ...ctx, name: "Suporte" });
  await teamMembershipRepository.add({ teamId: comercial.id, userId: gerenteId, role: "admin", attendanceLevel: "N1" });
  await teamMembershipRepository.add({ teamId: comercial.id, userId: carlosId, role: "editor", attendanceLevel: "N1" });
  await teamMembershipRepository.add({ teamId: suporte.id, userId: anaId, role: "editor", attendanceLevel: "N1" });
  const connection = await inbox.connectionRepository.create({ ...ctx, provider: "wuzapi", displayName: "C" });
  const [type] = await listClosureTypes(inbox, ctx);

  // Carlos atende e finaliza um; Ana atende outro (de outra equipe).
  const talk = async (phone, userId, teamId) => {
    const { conversation } = await registerInboundMessage(inbox, { ...ctx, connectionId: connection.id, chatId: `${phone}@s.whatsapp.net`, chatPhoneE164: `+${phone}`, isGroup: false, fromMe: false, senderId: phone, externalMessageId: nextId("in"), type: "text", body: "oi", occurredAt: new Date().toISOString() });
    await inbox.conversationRepository.setTeam(conversation.id, teamId);
    await assignConversation(inbox, { ...ctx, conversationId: conversation.id, assignedUserId: userId, performedBy: ownerId });
    await sendInboxMessage(inbox, { ...ctx, conversationId: conversation.id, body: "olá", sentByUserId: userId });
    return conversation;
  };
  const carlosConversation = await talk("5511900001001", carlosId, comercial.id);
  await talk("5511900001002", anaId, suporte.id);
  await closeConversation(inbox, { ...ctx, conversationId: carlosConversation.id, performedBy: carlosId, closureTypeId: type.id, closureSubtypeId: type.subtypes[0].id });

  const deps = { dashboardRepository: new PostgresDashboardRepository(db.pool), workspaceRepository, membershipRepository, teamRepository, teamMembershipRepository };
  const principal = async (userId) => {
    const membership = await membershipRepository.getByUserAndTenant(userId, tenantId);
    return { userId, tenantId, role: membership.role, sessionId: "s", isPlatformAdmin: false, permissions: effectivePermissions(membership.role) };
  };

  const carlosView = await getDashboard(deps, await principal(carlosId), { workspaceId: workspace.id, period: "today" });
  assert.equal(carlosView.attendance.volume.finalized, 1);
  assert.equal(carlosView.attendance.frt.sample, 1, "só o ciclo do próprio Carlos");
  assert.equal(carlosView.attendance.backlog.total, 0, "o atendimento aberto da Ana não aparece para Carlos");
  assert.deepEqual(carlosView.options.viewings.map((option) => option.value), ["me"]);
  await assert.rejects(getDashboard(deps, await principal(carlosId), { workspaceId: workspace.id, viewing: `team:${comercial.id}` }), /DASHBOARD_SCOPE_FORBIDDEN/);
  await assert.rejects(getDashboard(deps, await principal(carlosId), { workspaceId: workspace.id, viewing: `user:${anaId}` }), /DASHBOARD_SCOPE_FORBIDDEN/);

  const gerenteTeam = await getDashboard(deps, await principal(gerenteId), { workspaceId: workspace.id, viewing: `team:${comercial.id}`, period: "today" });
  assert.equal(gerenteTeam.attendance.volume.finalized, 1);
  assert.equal(gerenteTeam.attendance.backlog.total, 0, "a fila do Suporte não é da equipe dele");
  assert.ok(gerenteTeam.attendance.agents.some((row) => row.userId === carlosId && row.finalized === 1), "comparativo: Carlos finalizou 1");
  assert.ok(!gerenteTeam.options.viewings.some((option) => option.value === `team:${suporte.id}` || option.value === "company"));
  await assert.rejects(getDashboard(deps, await principal(gerenteId), { workspaceId: workspace.id, viewing: `team:${suporte.id}` }), /DASHBOARD_SCOPE_FORBIDDEN/);
  await assert.rejects(getDashboard(deps, await principal(gerenteId), { workspaceId: workspace.id, viewing: "company" }), /DASHBOARD_SCOPE_FORBIDDEN/);

  const company = await getDashboard(deps, await principal(ownerId), { workspaceId: workspace.id, viewing: "company", period: "today" });
  assert.equal(company.attendance.volume.opened, 2);
  assert.equal(company.attendance.backlog.total, 1);
  assert.equal(company.attendance.teams.length, 2, "comparativo entre equipes");
  assert.equal(company.commercial.available, false, "sem Sales Engine configurado, o bloco comercial fica indisponível (nunca inventado)");
});
