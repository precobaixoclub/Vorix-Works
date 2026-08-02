import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { InMemorySchedulingRepository } from "../dist/infrastructure/storage/in-memory-scheduling-repository.js";
import { ScheduleOccurrenceGenerator } from "../dist/application/scheduling/schedule-occurrence-generator.js";
import { ScheduleConflictDetector } from "../dist/application/scheduling/schedule-conflict-detector.js";
import { TemporalDispatcher } from "../dist/application/scheduling/temporal-queue.js";
import { MutableTestClock } from "../dist/application/ports/clock.port.js";
import { signWebhookPayload } from "../dist/application/webhook/webhook-signature-verifier.js";

function buildTestApp(role = "owner", env = {}) {
  return buildApp({
    config: loadApiConfig({
      AUTH_MODE: "noop",
      DEV_PRINCIPAL_TENANT_ID: "tenant-scheduling-api",
      DEV_PRINCIPAL_USER_ID: `user-${role}`,
      DEV_PRINCIPAL_ROLE: role,
      ZUNO_LOG_LEVEL: "silent",
      PUBLICATION_CANARY_ENABLED: "true",
      PUBLICATION_CANARY_TENANT_IDS: "tenant-scheduling-api",
      PUBLICATION_CANARY_WORKSPACE_IDS: "workspace-scheduling-api",
      SCHEDULING_MISSED_GRACE_MS: "900000",
      ...env,
    }),
  });
}

test("Scheduling: gerador materializa recorrencia diaria com timezone IANA e transicao DST", () => {
  const generator = new ScheduleOccurrenceGenerator({ windowDays: 10, maxOccurrencesPerRun: 20 });
  const schedule = {
    id: "schedule-dst",
    tenantId: "tenant",
    workspaceId: "workspace",
    publicationPlanId: "publication",
    publicationCandidateId: "candidate",
    providerId: "dry_run",
    targetId: "target",
    status: "scheduled",
    timezone: "America/New_York",
    scheduledAtUtc: "2026-03-07T14:00:00.000Z",
    scheduledAtLocal: "2026-03-07T09:00:00",
    missedPolicy: "manual_review",
    allowDegradedProvider: false,
    maxAttempts: 3,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    version: 0,
    recurrence: {
      id: "schedule-dst:rule",
      scheduleId: "schedule-dst",
      tenantId: "tenant",
      workspaceId: "workspace",
      frequency: "daily",
      startAtLocal: "2026-03-07T09:00:00",
      startAtUtc: "2026-03-07T14:00:00.000Z",
      timezone: "America/New_York",
      interval: 1,
      count: 3,
      windowDays: 10,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
  };
  const occurrences = generator.generate({ schedule, fromUtc: "2026-03-07T00:00:00.000Z", idGenerator: () => "ignored" });
  assert.equal(occurrences.length, 3);
  assert.equal(occurrences[0].dueAtUtc, "2026-03-07T14:00:00.000Z");
  assert.equal(occurrences[1].dueAtUtc, "2026-03-08T13:00:00.000Z");
  assert.equal(occurrences[2].dueAtUtc, "2026-03-09T13:00:00.000Z");
  assert.equal(occurrences[1].timezone, "America/New_York");
  assert.equal(occurrences[0].idempotencyKey, occurrences[0].idempotencyKey);
});

test("Scheduling repository: claim atomico, lease expirado, fencing token e idempotencia", async () => {
  const repository = new InMemorySchedulingRepository();
  await repository.createSchedule(baseSchedule({ id: "schedule-claim" }));
  const [occurrence] = await repository.upsertOccurrences([baseOccurrence({ id: "occurrence-claim", scheduleId: "schedule-claim", dueAtUtc: "2026-07-30T10:00:00.000Z" })]);
  const duplicate = await repository.upsertOccurrences([baseOccurrence({ id: "occurrence-claim-copy", scheduleId: "schedule-claim", dueAtUtc: "2026-07-30T10:00:00.000Z" })]);
  assert.equal(duplicate[0].id, occurrence.id);

  const [claimA] = await repository.claimDueOccurrences({ workerId: "worker-a", now: "2026-07-30T10:01:00.000Z", leaseMs: 1000, limit: 1 });
  assert.equal(claimA.claimedBy, "worker-a");
  assert.equal(await repository.completeOccurrence({ occurrenceId: claimA.id, workerId: "worker-a", fencingToken: claimA.fencingToken + 1, now: "2026-07-30T10:01:00.100Z" }), false);

  assert.equal(await repository.releaseExpiredLeases("2026-07-30T10:01:02.000Z"), 1);
  const [claimB] = await repository.claimDueOccurrences({ workerId: "worker-b", now: "2026-07-30T10:01:02.000Z", leaseMs: 1000, limit: 1 });
  assert.equal(claimB.claimedBy, "worker-b");
  assert.equal(await repository.completeOccurrence({ occurrenceId: claimA.id, workerId: "worker-a", fencingToken: claimA.fencingToken, now: "2026-07-30T10:01:02.100Z" }), false);
  assert.equal(await repository.completeOccurrence({ occurrenceId: claimB.id, workerId: "worker-b", fencingToken: claimB.fencingToken, now: "2026-07-30T10:01:02.100Z", executionReference: { publicationId: "publication", targetId: "target" } }), true);
});

test("Scheduling: conflito bloqueante impede claim da ocorrencia conflitante", async () => {
  const repository = new InMemorySchedulingRepository();
  const detector = new ScheduleConflictDetector({ repository, idGenerator: (() => { let n = 0; return () => `conflict-${++n}`; })(), conflictWindowMinutes: 30 });
  const scheduleA = await repository.createSchedule(baseSchedule({ id: "schedule-a" }));
  const scheduleB = await repository.createSchedule(baseSchedule({ id: "schedule-b" }));
  await repository.upsertOccurrences([baseOccurrence({ id: "occurrence-a", scheduleId: scheduleA.id, dueAtUtc: "2026-07-30T10:00:00.000Z" })]);
  const [occurrenceB] = await repository.upsertOccurrences([baseOccurrence({ id: "occurrence-b", scheduleId: scheduleB.id, dueAtUtc: "2026-07-30T10:10:00.000Z" })]);

  const conflicts = await detector.detectForOccurrences({ schedule: scheduleB, occurrences: [occurrenceB] });
  assert.equal(conflicts.some((conflict) => conflict.severity === "blocking" && conflict.code === "SAME_TARGET_PROVIDER_WINDOW"), true);
  const claimed = await repository.claimDueOccurrences({ workerId: "worker", now: "2026-07-30T10:30:00.000Z", leaseMs: 60_000, limit: 10 });
  assert.deepEqual(claimed.map((item) => item.id), ["occurrence-a"]);
});

test("Scheduling dispatcher: falha nao retentavel cria dead letter e reprocessamento administrativo preserva ocorrencia", async () => {
  const repository = new InMemorySchedulingRepository();
  const clock = new MutableTestClock(new Date("2026-07-30T10:01:00.000Z"));
  await repository.createSchedule(baseSchedule({ id: "schedule-dead", maxAttempts: 1 }));
  await repository.upsertOccurrences([baseOccurrence({ id: "occurrence-dead", scheduleId: "schedule-dead", dueAtUtc: "2026-07-30T10:00:00.000Z" })]);
  const dispatcher = new TemporalDispatcher({
    repository,
    clock,
    idGenerator: (() => { let n = 0; return () => `schedule-event-${++n}`; })(),
    leaseMs: 60_000,
    maxBatch: 10,
    missedGraceMs: 15 * 60_000,
    auditRepository: { record: async (input) => ({ ...input, createdAt: clock.nowIso() }), list: async () => [], export: async () => ({ contentType: "application/json", body: "[]" }) },
    dispatcher: { dispatch: async () => ({ dispatched: false, category: "credential", code: "CREDENTIAL_INVALID", safeMessage: "Credencial invalida.", deadLetter: true }) },
  });
  const result = await dispatcher.dispatchDue({ workerId: "worker", actor: { userId: "owner", role: "owner" } });
  assert.equal(result.deadLettered, 1);
  const [letter] = await repository.listDeadLetters({ tenantId: "tenant", workspaceId: "workspace" });
  assert.equal(letter.failureCode, "CREDENTIAL_INVALID");
  await repository.reprocessDeadLetter({ id: letter.id, tenantId: "tenant", workspaceId: "workspace", actorUserId: "owner", now: clock.nowIso() });
  assert.equal((await repository.getOccurrence("occurrence-dead")).status, "pending");
});

test("Scheduling API: schedule due passa por governance, credential, provider health, Publication Outbox, sandbox dispatch, receipt, webhook sync e audit", async () => {
  const app = await buildTestApp("owner");
  const workspaceId = "workspace-scheduling-api";
  const connect = await app.inject({ method: "POST", url: "/v1/providers/linkedin_sandbox/connect", payload: { workspaceId } });
  assert.equal(connect.statusCode, 200);
  const credentialReferenceId = connect.json().data.credentialReferenceId;

  const createPublication = await app.inject({
    method: "POST",
    url: "/v1/publications",
    payload: {
      workspaceId,
      idempotencyKey: "scheduling-publication-linkedin",
      artifacts: [{ id: "artifact-scheduling", artifactType: "document", schemaId: "publication.manifest", schemaVersion: 1, checksum: "checksum-scheduling", payload: { caption: "Agendamento editorial" } }],
      channels: ["linkedin"],
      mode: "real",
      provider: "linkedin_sandbox",
      policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["linkedin_sandbox"], publishMode: "real" },
    },
  });
  assert.equal(createPublication.statusCode, 200);
  const plan = createPublication.json().data;
  const detail = await app.inject({ method: "GET", url: `/v1/publications/${plan.id}?workspaceId=${workspaceId}` });
  const candidate = detail.json().data.candidates[0];
  const target = detail.json().data.targets[0];

  const scheduleCreate = await app.inject({
    method: "POST",
    url: "/v1/schedules",
    payload: {
      workspaceId,
      publicationPlanId: plan.id,
      publicationCandidateId: candidate.id,
      providerId: "linkedin_sandbox",
      targetId: target.id,
      credentialReferenceId,
      scheduledAt: localInZone(new Date(Date.now() - 60_000), "America/Sao_Paulo"),
      timezone: "America/Sao_Paulo",
      maxAttempts: 2,
    },
  });
  assert.equal(scheduleCreate.statusCode, 200);
  const schedule = scheduleCreate.json().data.schedule;
  const occurrence = scheduleCreate.json().data.occurrences[0];
  assert.equal(schedule.timezone, "America/Sao_Paulo");
  assert.equal(occurrence.status, "pending");

  const run = await app.inject({ method: "POST", url: "/v1/scheduling/operate/run-due", payload: { workspaceId, workerId: "worker-api-1" } });
  assert.equal(run.statusCode, 200);
  assert.equal(run.json().data.claimed, 1);
  assert.equal(run.json().data.dispatched, 1);

  const after = await app.inject({ method: "GET", url: `/v1/publications/${plan.id}?workspaceId=${workspaceId}` });
  assert.equal(after.json().data.outbox[0].status, "dispatched");
  assert.equal(after.json().data.receipts.length, 1);
  const receipt = after.json().data.receipts[0];

  const webhookPayload = {
    type: "receipt_updated",
    tenantId: "tenant-scheduling-api",
    workspaceId,
    publicationId: plan.id,
    targetId: target.id,
    providerPublicationId: receipt.providerPublicationId,
    providerRequestId: "schedule-webhook-request",
    idempotencyKey: target.idempotencyKey,
    channel: "linkedin",
    externalStatus: "updated",
    url: receipt.url,
    occurredAt: "2026-07-30T12:00:00.000Z",
  };
  const timestamp = new Date().toISOString();
  const nonce = "schedule-webhook-nonce";
  const rawPayload = JSON.stringify(webhookPayload);
  const signature = signWebhookPayload({ secret: "linkedin-sandbox-webhook-secret", timestamp, nonce, rawPayload });
  const webhook = await app.inject({ method: "POST", url: "/webhooks/linkedin_sandbox", headers: { "x-zuno-signature": signature, "x-zuno-timestamp": timestamp, "x-zuno-nonce": nonce }, payload: webhookPayload });
  assert.equal(webhook.statusCode, 202);

  const calendar = await app.inject({ method: "GET", url: `/v1/calendar?workspaceId=${workspaceId}&from=2000-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z` });
  assert.equal(calendar.statusCode, 200);
  assert.equal(calendar.json().data.some((entry) => entry.schedule.id === schedule.id && entry.occurrence.status === "dispatched"), true);

  const audit = await app.inject({ method: "GET", url: `/v1/audit?workspaceId=${workspaceId}` });
  assert.equal(audit.json().data.some((event) => event.eventType === "schedule.occurrence_dispatched"), true);
  assert.equal(audit.json().data.some((event) => event.eventType === "publication.sync"), true);
  const health = await app.inject({ method: "GET", url: `/v1/scheduling/health?workspaceId=${workspaceId}` });
  assert.equal(health.statusCode, 200);
  assert.equal(["healthy", "degraded"].includes(health.json().data.status), true);

  await app.close();
});

test("Scheduling API: recovery marca ocorrencia atrasada como missed e run-due nao publica automaticamente", async () => {
  const app = await buildTestApp("owner");
  const workspaceId = "workspace-scheduling-api";
  const createPublication = await app.inject({
    method: "POST",
    url: "/v1/publications",
    payload: {
      workspaceId,
      idempotencyKey: "scheduling-publication-missed",
      artifacts: [{ id: "artifact-missed", artifactType: "document", schemaId: "publication.manifest", schemaVersion: 1, checksum: "checksum-missed", payload: { caption: "Missed" } }],
      channels: ["instagram"],
      policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["dry_run"], publishMode: "dry_run" },
    },
  });
  const plan = createPublication.json().data;
  const detail = await app.inject({ method: "GET", url: `/v1/publications/${plan.id}?workspaceId=${workspaceId}` });
  const candidate = detail.json().data.candidates[0];
  const target = detail.json().data.targets[0];

  const scheduleCreate = await app.inject({
    method: "POST",
    url: "/v1/schedules",
    payload: {
      workspaceId,
      publicationPlanId: plan.id,
      publicationCandidateId: candidate.id,
      providerId: "dry_run",
      targetId: target.id,
      scheduledAt: "2026-01-01T09:00:00",
      timezone: "America/Sao_Paulo",
    },
  });
  assert.equal(scheduleCreate.statusCode, 200);
  const occurrence = scheduleCreate.json().data.occurrences[0];

  const recover = await app.inject({ method: "POST", url: "/v1/scheduling/operate/recover", payload: { workspaceId } });
  assert.equal(recover.statusCode, 200);
  assert.equal(recover.json().data.missed >= 1, true);
  const run = await app.inject({ method: "POST", url: "/v1/scheduling/operate/run-due", payload: { workspaceId } });
  assert.equal(run.json().data.claimed, 0);
  const occurrences = await app.inject({ method: "GET", url: `/v1/schedules/${scheduleCreate.json().data.schedule.id}/occurrences?workspaceId=${workspaceId}` });
  assert.equal(occurrences.json().data.find((item) => item.id === occurrence.id).status, "missed");

  await app.close();
});

function baseSchedule(overrides = {}) {
  return {
    id: "schedule",
    tenantId: "tenant",
    workspaceId: "workspace",
    publicationPlanId: "publication",
    publicationCandidateId: "candidate",
    providerId: "dry_run",
    targetId: "target",
    status: "scheduled",
    timezone: "America/Sao_Paulo",
    scheduledAtUtc: "2026-07-30T10:00:00.000Z",
    scheduledAtLocal: "2026-07-30T07:00:00",
    missedPolicy: "manual_review",
    allowDegradedProvider: false,
    maxAttempts: 3,
    ...overrides,
  };
}

function baseOccurrence(overrides = {}) {
  const id = overrides.id ?? "occurrence";
  const scheduleId = overrides.scheduleId ?? "schedule";
  return {
    id,
    scheduleId,
    occurrenceKey: overrides.occurrenceKey ?? "2026-07-30T07:00:00",
    occurrenceNumber: overrides.occurrenceNumber ?? 1,
    tenantId: "tenant",
    workspaceId: "workspace",
    publicationPlanId: "publication",
    publicationCandidateId: "candidate",
    providerId: "dry_run",
    targetId: "target",
    status: "pending",
    dueAtUtc: overrides.dueAtUtc ?? "2026-07-30T10:00:00.000Z",
    localDateTime: "2026-07-30T07:00:00",
    timezone: "America/Sao_Paulo",
    idempotencyKey: overrides.idempotencyKey ?? `${scheduleId}:occurrence:candidate:dry_run:target`,
    ...overrides,
  };
}

function localInZone(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
