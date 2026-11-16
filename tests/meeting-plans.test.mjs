import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresMeetingPlanRepository } from "../dist/infrastructure/storage/postgres/postgres-meeting-plan-repository.js";
import { PostgresSolutionEntitlementRepository } from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { SolutionAccessService } from "../dist/application/solutions/solution-access.service.js";
import { syncMeetingsEntitlementFromSubscription } from "../dist/application/billing/meetings-offer.js";
import {
  adminMeetingPlanAction,
  meetingRecordingGate,
  runMeetingPlanMaintenance,
  startMeetingTrial,
} from "../dist/application/meetings/meeting-plans.js";
import {
  activatePlan,
  addOneMonth,
  advanceMeetingPlan,
  changePlan,
  dueRetentionNotice,
  markPaymentFailed,
  markPaymentRecovered,
  meetingPlanEntitlement,
  MEETING_PLANS,
  recordingAllowance,
  recordingDeletionDate,
  scheduleCancellation,
  startTrial,
} from "../dist/domain/meetings/meeting-plans.model.js";
import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Planos de gravação do Meetings: teste gratuito único, franquia por ciclo, troca de plano,
 * renovação, cancelamento, falha de pagamento, retenção/avisos e o bloqueio no backend.
 */

const DAY = 86_400_000;
const T0 = new Date("2026-11-16T12:00:00.000Z");
const at = (days) => new Date(T0.getTime() + days * DAY);

// --- Regras puras -------------------------------------------------------------------------------

test("CICLO: mês seguinte no mesmo dia, sem pular fevereiro", () => {
  assert.equal(addOneMonth("2026-01-31T10:00:00.000Z"), "2026-02-28T10:00:00.000Z");
  assert.equal(addOneMonth("2028-01-31T10:00:00.000Z"), "2028-02-29T10:00:00.000Z");
  assert.equal(addOneMonth("2026-11-16T12:00:00.000Z"), "2026-12-16T12:00:00.000Z");
  assert.equal(addOneMonth("2026-12-20T00:00:00.000Z"), "2027-01-20T00:00:00.000Z");
});

test("CATÁLOGO: preços, franquias e retenções exatamente como definidos", () => {
  assert.deepEqual(
    Object.values(MEETING_PLANS).map((plan) => [plan.code, plan.priceCents, plan.recordingMinutes / 60, plan.retentionDays]),
    [["individual", 1990, 20, 90], ["professional", 3990, 60, 180], ["teams", 7990, 150, 365]],
  );
});

test("TESTE GRÁTIS: 7 dias, 5 h, um por organização e expira com janela de exportação", () => {
  const { next: trial, events } = startTrial(undefined, "t1", T0);
  assert.equal(trial.status, "trial");
  assert.equal(trial.currentPeriodEnd, at(7).toISOString());
  assert.equal(events[0].kind, "trial_started");

  assert.equal(recordingAllowance(trial, 4 * 3600, at(1)).ok, true);
  const exhausted = recordingAllowance(trial, 5 * 3600, at(1));
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.reason, "PLAN_QUOTA_REACHED");

  const afterSeven = recordingAllowance(trial, 0, at(7));
  assert.equal(afterSeven.reason, "TRIAL_EXPIRED", "terminou o prazo: bloqueia mesmo antes do scheduler rodar");

  const { next: expired } = advanceMeetingPlan(trial, at(8));
  assert.equal(expired.status, "expired");
  assert.equal(expired.exportUntil, at(37).toISOString(), "30 dias para exportar a partir do fim do teste");
  assert.equal(meetingPlanEntitlement(expired, at(20)).enabled, true, "ainda acessa para exportar");
  assert.equal(meetingPlanEntitlement(expired, at(38)).enabled, false);

  assert.throws(() => startTrial(expired, "t1", at(9)), /TRIAL_ALREADY_USED/);
  assert.throws(() => startTrial(activatePlan(expired, "t1", "individual", at(9)).next, "t1", at(10)), /TRIAL_ALREADY_USED/, "contratar não devolve o teste");
});

test("UPGRADE imediato, DOWNGRADE na renovação, renovação sem acúmulo e sem pular ciclos", () => {
  const active = activatePlan(undefined, "t2", "individual", T0).next;
  assert.equal(active.currentPeriodEnd, "2026-12-16T12:00:00.000Z");

  const up = changePlan(active, "professional", at(3));
  assert.equal(up.next.planCode, "professional");
  assert.equal(up.next.currentPeriodStart, active.currentPeriodStart, "upgrade não reinicia o ciclo");
  assert.equal(recordingAllowance(up.next, 30 * 3600, at(3)).ok, true, "franquia maior vale na hora");

  const down = changePlan(up.next, "individual", at(4));
  assert.equal(down.next.planCode, "professional", "downgrade não muda o plano agora");
  assert.equal(down.next.pendingPlanCode, "individual");
  const undo = changePlan(down.next, "professional", at(5));
  assert.equal(undo.next.pendingPlanCode, undefined, "voltar ao plano atual desfaz o downgrade");

  const renewed = advanceMeetingPlan(down.next, new Date("2026-12-16T12:00:01.000Z"));
  assert.equal(renewed.next.planCode, "individual");
  assert.equal(renewed.next.currentPeriodStart, "2026-12-16T12:00:00.000Z");
  assert.deepEqual(renewed.events.map((event) => event.kind), ["downgrade_applied", "renewed"]);

  const late = advanceMeetingPlan(active, new Date("2027-02-20T00:00:00.000Z"));
  assert.equal(late.next.currentPeriodStart, "2027-02-16T12:00:00.000Z", "worker parado: alcança o ciclo de agora");
  assert.equal(advanceMeetingPlan(late.next, new Date("2027-02-21T00:00:00.000Z")).events.length, 0, "idempotente");
});

test("CANCELAMENTO no fim do ciclo e FALHA DE PAGAMENTO com carência de 7 dias", () => {
  const active = activatePlan(undefined, "t3", "teams", T0).next;
  const canceling = scheduleCancellation(active, at(10)).next;
  assert.equal(canceling.cancelAtPeriodEnd, true);
  assert.equal(recordingAllowance(canceling, 0, at(11)).ok, true, "continua gravando até o fim do ciclo pago");
  const ended = advanceMeetingPlan(canceling, at(31)).next;
  assert.equal(ended.status, "canceled");
  assert.equal(ended.endedAt, canceling.currentPeriodEnd);
  assert.equal(recordingAllowance(ended, 0, at(31)).reason, "PLAN_ENDED");

  const failed = markPaymentFailed(active, at(5)).next;
  assert.equal(recordingAllowance(failed, 0, at(5)).reason, "PAYMENT_FAILED");
  assert.equal(meetingPlanEntitlement(failed, at(5)).enabled, true, "dados preservados durante a pendência");
  const recovered = markPaymentRecovered(failed, at(6)).next;
  assert.equal(recovered.status, "active");
  assert.equal(recovered.currentPeriodStart, at(6).toISOString());
  const unpaid = advanceMeetingPlan(failed, at(12)).next;
  assert.equal(unpaid.status, "canceled", "7 dias sem regularizar encerra");
  assert.equal(unpaid.exportUntil, at(42).toISOString());
});

test("RETENÇÃO: data de exclusão e avisos de 15 e 3 dias sem repetir", () => {
  assert.equal(recordingDeletionDate({ recordedAt: T0.toISOString(), retentionDays: 90 }), at(90).toISOString());
  assert.equal(recordingDeletionDate({ recordedAt: T0.toISOString(), retentionDays: 90, exportUntil: at(40).toISOString() }), at(40).toISOString(), "janela de exportação antecipa");
  const deletionAt = at(90).toISOString();
  assert.equal(dueRetentionNotice({ deletionAt, now: at(70), sent: [] }), undefined);
  assert.equal(dueRetentionNotice({ deletionAt, now: at(76), sent: [] }), 15);
  assert.equal(dueRetentionNotice({ deletionAt, now: at(77), sent: [15] }), undefined);
  assert.equal(dueRetentionNotice({ deletionAt, now: at(88), sent: [15] }), 3);
  assert.equal(dueRetentionNotice({ deletionAt, now: at(88), sent: [] }), 3, "perdeu o de 15: só o de 3");
  assert.equal(dueRetentionNotice({ deletionAt, now: at(91), sent: [] }), undefined);
});

// --- Banco real (PGlite) + API ------------------------------------------------------------------

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-p${++counter}`;
before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, join(process.cwd(), "db", "migrations"));
});
after(async () => {
  await db.stop();
});

let clock = T0;
const plansDeps = () => ({
  plans: new PostgresMeetingPlanRepository(db.pool),
  entitlements: new PostgresSolutionEntitlementRepository(db.pool),
  now: () => clock,
  idGenerator: nextId,
});

async function addRecording({ tenantId, seconds, createdAt, status = "available" }) {
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("ws") }).create({ tenantId, name: "WS" });
  const meetingId = nextId("meet");
  await db.pool.query(
    `insert into meetings (id, tenant_id, workspace_id, owner_user_id, created_by_user_id, title, source, status) values ($1, $2, $3, 'u1', 'u1', 'Reunião', 'upload', 'completed')`,
    [meetingId, tenantId, workspace.id],
  );
  const recordingId = nextId("rec");
  await db.pool.query(
    `insert into meeting_recordings (id, meeting_id, tenant_id, workspace_id, kind, storage_key, mime_type, bytes, duration_seconds, checksum_sha256, status, created_at)
     values ($1, $2, $3, $4, 'original', $5, 'audio/mp4', 1000, $6, 'x', $7, $8)`,
    [recordingId, meetingId, tenantId, workspace.id, `meetings/${recordingId}.m4a`, seconds, status, createdAt.toISOString()],
  );
  return { recordingId, meetingId, workspaceId: workspace.id };
}

test("POSTGRES: teste único, consumo por ciclo, gate e entitlement derivado do plano", async () => {
  clock = T0;
  const deps = plansDeps();
  const actor = { tenantId: "tp-1", userId: "owner-1", role: "owner" };
  await startMeetingTrial(deps, actor);
  await assert.rejects(startMeetingTrial(deps, actor), /TRIAL_ALREADY_USED|PLAN_ALREADY_ACTIVE/);

  const entitlement = (await deps.entitlements.listByTenant("tp-1")).find((row) => row.solutionKey === "meetings");
  assert.equal(entitlement.enabled, true);
  assert.equal(entitlement.source, "subscription");
  assert.equal(entitlement.limits.recordingPlan, 1);
  assert.equal(entitlement.limits.meetingRetentionDays, 90);
  assert.equal(entitlement.limits.monthlyRecordingMinutes, 0, "limite antigo (mês civil) desligado: a franquia é do ciclo");

  const gate = meetingRecordingGate(deps);
  assert.deepEqual(await gate("tp-1"), { ok: true });
  assert.equal(await gate("sem-plano"), undefined, "tenant sem plano segue a regra antiga");

  await addRecording({ tenantId: "tp-1", seconds: 3 * 3600, createdAt: at(1) });
  await addRecording({ tenantId: "tp-1", seconds: 3600, createdAt: at(2), status: "failed" });
  await addRecording({ tenantId: "tp-1", seconds: 9 * 3600, createdAt: at(-3) });
  assert.equal(await deps.plans.usedSeconds("tp-1", T0.toISOString(), at(7).toISOString()), 3 * 3600, "só o que foi gravado dentro do ciclo, sem falhas");
  assert.deepEqual(await gate("tp-1"), { ok: true });
  await addRecording({ tenantId: "tp-1", seconds: 2 * 3600 + 1, createdAt: at(2) });
  const refused = await gate("tp-1");
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "PLAN_QUOTA_REACHED");

  // A sincronização da assinatura da plataforma não derruba o acesso vindo do plano.
  await syncMeetingsEntitlementFromSubscription({
    subscriptionRepository: { getActiveByTenant: async () => undefined },
    subscriptionItemRepository: { listBySubscription: async () => [] },
    addonDefinitionRepository: { getByCode: async () => undefined },
    solutionEntitlementRepository: deps.entitlements,
  }, "tp-1");
  assert.equal((await deps.entitlements.listByTenant("tp-1")).find((row) => row.solutionKey === "meetings").enabled, true);

  // Fim do teste → expira; contratar (admin) libera de novo com ciclo novo.
  clock = at(8);
  const maintenanceDeps = { ...plansDeps(), media: { delete: async () => undefined }, markRecordingPurged: async () => true, audit: async () => undefined };
  const result = await runMeetingPlanMaintenance(maintenanceDeps, { limit: 10, defaultRetentionDays: 90 });
  assert.equal(result.advanced, 1);
  assert.equal((await gate("tp-1")).reason, "TRIAL_EXPIRED");
  await adminMeetingPlanAction(plansDeps(), { tenantId: "tp-1", adminUserId: "admin", action: "activate", planCode: "professional" });
  assert.deepEqual(await gate("tp-1"), { ok: true }, "ciclo novo, franquia nova");
  const events = await deps.plans.listEvents("tp-1", 10);
  assert.deepEqual(events.map((event) => event.kind).sort(), ["plan_activated", "trial_expired", "trial_started"]);
  assert.equal((await deps.entitlements.listByTenant("tp-1")).find((row) => row.solutionKey === "meetings").limits.meetingRetentionDays, 180);
});

test("POSTGRES: concessão do operador nunca é sobrescrita pelo plano", async () => {
  clock = T0;
  const deps = plansDeps();
  await new SolutionAccessService({ repository: deps.entitlements, cacheTtlMs: 0 }).setEntitlement({ tenantId: "tp-op", solutionKey: "meetings", enabled: true, source: "internal", reason: "homologação", limits: { maxConcurrentRecordings: 3 } });
  await startMeetingTrial(deps, { tenantId: "tp-op", userId: "u", role: "owner" });
  const row = (await deps.entitlements.listByTenant("tp-op")).find((entry) => entry.solutionKey === "meetings");
  assert.equal(row.source, "internal");
  assert.equal(row.limits.maxConcurrentRecordings, 3);
});

test("POSTGRES: fim da janela de exportação remove os arquivos (auditado) e fecha o acesso; avisos 15/3 dias", async () => {
  clock = T0;
  const deps = plansDeps();
  await adminMeetingPlanAction(deps, { tenantId: "tp-win", adminUserId: "admin", action: "activate", planCode: "individual" });
  const recent = await addRecording({ tenantId: "tp-win", seconds: 600, createdAt: at(1) });
  const old = await addRecording({ tenantId: "tp-win", seconds: 600, createdAt: at(-80) });
  const removed = [];
  const audits = [];
  const notices = [];
  const maintenance = () => runMeetingPlanMaintenance({
    ...plansDeps(),
    media: { delete: async (key) => { removed.push(key); } },
    markRecordingPurged: async (recordingId) => (await db.pool.query("update meeting_recordings set status = 'purged' where id = $1 and status = 'available'", [recordingId])).rowCount > 0,
    audit: async (entry) => { audits.push(entry); },
    notify: async (notice) => { notices.push(notice); },
  }, { limit: 10, defaultRetentionDays: 90 });

  // Gravação de 80 dias atrás (retenção 90): faltam 10 dias → aviso de 15, uma vez só.
  let result = await maintenance();
  assert.equal(result.notices, 1);
  assert.equal(notices[0].meetingId, old.meetingId);
  assert.match(notices[0].title, /15 dias/);
  assert.equal((await maintenance()).notices, 0, "nunca repete");

  // Cancela → fim do ciclo → janela de 30 dias → arquivos removidos e acesso fechado.
  await adminMeetingPlanAction(deps, { tenantId: "tp-win", adminUserId: "admin", action: "cancel" });
  clock = new Date("2026-12-16T12:00:01.000Z");
  result = await maintenance();
  assert.equal((await deps.plans.get("tp-win")).status, "canceled");
  assert.equal(result.filesRemoved, 0, "dentro da janela nada é apagado");
  clock = new Date("2027-01-16T12:00:01.000Z");
  result = await maintenance();
  assert.ok(result.windowsClosed >= 1);
  assert.ok((await deps.plans.get("tp-win")).exportClosedAt, "janela fechada");
  assert.ok(removed.includes(`meetings/${recent.recordingId}.m4a`));
  assert.ok(audits.every((entry) => entry.action === "recording.purged"));
  const entitlement = (await deps.entitlements.listByTenant("tp-win")).find((row) => row.solutionKey === "meetings");
  assert.equal(entitlement.enabled, false);
  assert.equal(entitlement.limits.recordingPlan, 0, "plano encerrado devolve o controle à assinatura da plataforma");
  assert.equal((await maintenance()).windowsClosed, 0, "idempotente");
});

// --- API --------------------------------------------------------------------------------------

const authPort = {
  async verifyToken(token) {
    if (!token) return { authenticated: false, reason: "missing_token" };
    const [tenantId, role, userId, admin] = token.split("|");
    return { authenticated: true, principal: { tenantId, role, userId, sessionId: "s1", isPlatformAdmin: admin === "admin" } };
  },
};
const auth = (tenantId, role = "owner", admin = "") => ({ authorization: `Bearer ${tenantId}|${role}|user-${tenantId}|${admin}` });

async function buildTestApp() {
  clock = T0;
  const config = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" });
  return buildApp({ config, container: { authPort, meetingPlans: plansDeps() } });
}

test("API: catálogo, teste por organização, papéis, contratação fechada e isolamento", async () => {
  const app = await buildTestApp();
  try {
    const overview = await app.inject({ method: "GET", url: "/v1/meeting-plans", headers: auth("tp-api", "viewer") });
    assert.equal(overview.statusCode, 200);
    const data = overview.json().data;
    assert.equal(data.trialAvailable, true);
    assert.equal(data.checkoutOpen, false);
    assert.equal(data.canManage, false);
    assert.deepEqual(data.catalog.plans.map((plan) => plan.recordingHours), [20, 60, 150]);

    assert.equal((await app.inject({ method: "POST", url: "/v1/meeting-plans/trial", headers: auth("tp-api", "viewer"), payload: {} })).statusCode, 403, "viewer não inicia teste");
    const started = await app.inject({ method: "POST", url: "/v1/meeting-plans/trial", headers: auth("tp-api"), payload: {} });
    assert.equal(started.statusCode, 201);
    assert.equal(started.json().data.subscription.status, "trial");
    assert.equal(started.json().data.usage.limitSeconds, 5 * 3600);
    const again = await app.inject({ method: "POST", url: "/v1/meeting-plans/trial", headers: auth("tp-api"), payload: {} });
    assert.equal(again.statusCode, 409);

    const buy = await app.inject({ method: "POST", url: "/v1/meeting-plans/change", headers: auth("tp-api"), payload: { planCode: "professional" } });
    assert.equal(buy.statusCode, 409, "contratação paga fechada até a liberação da cobrança");
    assert.equal(buy.json().error.details.code, "MEETING_PLAN_CHECKOUT_CLOSED");

    // Outro tenant não enxerga nada do primeiro.
    const other = await app.inject({ method: "GET", url: "/v1/meeting-plans", headers: auth("tp-api-2") });
    assert.equal(other.json().data.subscription, undefined);
    assert.equal(other.json().data.trialAvailable, true);

    // Admin da plataforma: só ele ativa; o cliente então pode reduzir e cancelar.
    assert.equal((await app.inject({ method: "POST", url: "/v1/admin/meeting-plans/tp-api", headers: auth("tp-api"), payload: { action: "activate", planCode: "teams" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/v1/admin/meeting-plans/tp-api", headers: auth("x", "owner", "admin"), payload: { action: "activate", planCode: "teams" } })).statusCode, 200);
    const down = await app.inject({ method: "POST", url: "/v1/meeting-plans/change", headers: auth("tp-api"), payload: { planCode: "individual" } });
    assert.equal(down.statusCode, 200);
    assert.equal(down.json().data.subscription.pendingPlanCode, "individual");
    const up = await app.inject({ method: "POST", url: "/v1/meeting-plans/change", headers: auth("tp-api"), payload: { planCode: "teams" } });
    assert.equal(up.statusCode, 200, "voltar ao plano atual só desfaz o downgrade (sem cobrança)");
    const cancel = await app.inject({ method: "POST", url: "/v1/meeting-plans/cancel", headers: auth("tp-api"), payload: {} });
    assert.equal(cancel.json().data.subscription.cancelAtPeriodEnd, true);
    const revert = await app.inject({ method: "POST", url: "/v1/meeting-plans/revert-cancel", headers: auth("tp-api"), payload: {} });
    assert.equal(revert.json().data.subscription.cancelAtPeriodEnd, false);
    const history = await app.inject({ method: "GET", url: "/v1/admin/meeting-plans/tp-api", headers: auth("x", "owner", "admin") });
    assert.ok(history.json().data.events.length >= 5, "toda mudança fica auditada");
  } finally {
    await app.close();
  }
});

test("SITE: a página pública mostra exatamente o catálogo do backend", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(join(process.cwd(), "web", "features", "meeting-plans", "public-plans.ts"), "utf8");
  for (const plan of Object.values(MEETING_PLANS)) {
    const price = `R$ ${(plan.priceCents / 100).toFixed(2).replace(".", ",")}`;
    const line = source.split("\n").find((row) => row.includes(`code: "${plan.code}"`));
    assert.ok(line, `plano ${plan.code} no site`);
    assert.ok(line.includes(`price: "${price}"`), `${plan.code}: ${price}`);
    assert.ok(line.includes(`hours: ${plan.recordingMinutes / 60},`), `${plan.code}: horas`);
    assert.ok(line.includes(`retentionDays: ${plan.retentionDays},`), `${plan.code}: retenção`);
    assert.ok(line.includes(`concurrent: ${plan.maxConcurrentRecordings},`), `${plan.code}: simultâneas`);
  }
  assert.match(source, /days: 7, hours: 5/);
  assert.match(source, /SCREEN_CAPTURE_ENABLED = false/, "a produção grava só áudio: o site não promete tela");
});

test("EXPORTAÇÃO: nome do arquivo baixado é saneado (sem injeção de cabeçalho)", async () => {
  const { attachmentName } = await import("../dist/interfaces/api/routes/uploads.route.js");
  assert.equal(attachmentName("gravacao-mrec-1.m4a"), "gravacao-mrec-1.m4a");
  assert.equal(attachmentName('a"\r\nSet-Cookie: x=1.mp4'), "a-Set-Cookie-x-1.mp4");
  assert.equal(attachmentName("Reunião de março.mp4"), "Reuniao-de-marco.mp4");
  assert.equal(attachmentName("../../etc/passwd"), "etc-passwd");
  assert.equal(attachmentName(undefined), undefined);
  assert.equal(attachmentName(["x"]), undefined);
});
