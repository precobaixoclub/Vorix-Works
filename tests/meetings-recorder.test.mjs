import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresMeetingRepository } from "../dist/infrastructure/storage/postgres/postgres-meeting-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";
import { ObjectStorageMeetingMedia } from "../dist/infrastructure/meetings/object-storage-meeting-media.js";
import { decryptSecret, encryptSecret } from "../dist/infrastructure/crypto/secret-cipher.js";
import { processNextRecorderJob, recoverOrphanRecorders, RecorderFailure } from "../dist/application/meetings/meeting-recorder.js";
import { provisionRecorderBot } from "../dist/application/meetings/recorder-bot-admin.js";
import { evaluateAutoRecordings } from "../dist/application/meetings/meeting-processing.js";
import { stopMeetingRecording } from "../dist/application/meetings/meeting-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
const MASTER_KEY = "recorder-test-master-key";
let db;
let storageDir;
let counter = 0;
const nextId = (prefix) => `${prefix}-r${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55765 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
  storageDir = await mkdtemp(join(tmpdir(), "vorix-recorder-test-"));
});

after(async () => {
  await db.stop();
  await rm(storageDir, { recursive: true, force: true });
});

const repository = () => new PostgresMeetingRepository(db.pool);
const media = () => new ObjectStorageMeetingMedia(new LocalObjectStorage({ rootDir: storageDir, publicBaseUrl: "http://localhost/uploads" }));

async function account(label) {
  const tenantId = `tenant-rec-${label}`;
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("ws") }).create({ tenantId, name: label });
  return { tenantId, workspaceId: workspace.id };
}

async function queuedRecording(label, encryptedSessionState = encryptSecret(JSON.stringify({ cookies: [], origins: [] }), MASTER_KEY)) {
  const scope = await account(label);
  const repo = repository();
  const meeting = await repo.create({
    id: nextId("meeting"), tenantId: scope.tenantId, workspaceId: scope.workspaceId,
    ownerUserId: "owner-1", createdByUserId: "owner-1", title: label, source: "external_link",
    status: "scheduled", meetingUrl: "https://meet.google.com/abc-defg-hij", timezone: "America/Sao_Paulo",
    autoRecord: false, participants: [],
  });
  const botId = nextId("bot");
  await repo.upsertRecorderBot({ id: botId, label: `Bot ${label}`, googleEmail: `${botId}@example.test`, displayName: "Vorix Recorder", encryptedSessionState, status: "active" });
  const admission = await repo.admitRecording({ ...scope, meetingId: meeting.id, maxConcurrentRecordings: 1, now: new Date() });
  assert.equal(admission.ok, true);
  return { ...scope, meeting, botId, jobId: admission.jobId };
}

function deps(runtime, validator) {
  return {
    repository: repository(), media: media(), runtime, validator,
    decryptSession: (encrypted) => decryptSecret(encrypted, MASTER_KEY),
    workerId: "recorder-test-worker", leaseMs: 60_000, maxRecordingDurationMinutes: 60,
    admissionTimeoutMs: 10_000, idGenerator: nextId, now: () => new Date(),
  };
}

test("BOT MODEL: storageState e cifrado, nunca persistido em texto puro, e exige health check antes de ACTIVE", async () => {
  const repo = repository();
  const raw = { cookies: [{ name: "SID", value: "segredo", domain: ".google.com", path: "/" }], origins: [] };
  const bot = await provisionRecorderBot({ repository: repo, encryptSession: (value) => encryptSecret(value, MASTER_KEY), now: () => new Date() }, {
    id: nextId("bot-admin"), label: "Bot 01", googleEmail: "bot01@example.test", displayName: "Vorix Recorder", storageState: raw,
  });
  assert.equal(bot.status, "disabled");
  assert.equal(bot.hasEncryptedSessionState, true);
  const stored = await repo.getRecorderBotSession(bot.id);
  assert.ok(stored);
  assert.equal(stored.includes("segredo"), false);
  assert.deepEqual(JSON.parse(decryptSecret(stored, MASTER_KEY)), raw);
});

test("RECORDER: captura validada vai para storage e reutiliza o job de transcricao", async () => {
  const queued = await queuedRecording("success");
  let producedPath;
  const runtime = {
    async capture(input) {
      const dir = await mkdtemp(join(tmpdir(), "vorix-fake-capture-"));
      producedPath = join(dir, "capture.mp4");
      await input.onProcesses({ browserPid: 111, ffmpegPid: 222, display: ":141", audioSink: "sink_141", tempDir: dir });
      await input.onState("waiting_admission", new Date().toISOString());
      const joined = new Date().toISOString();
      await input.onState("recording", joined);
      await writeFile(producedPath, Buffer.from("real-recorder-contract-file"));
      return { filePath: producedPath, stopReason: "meeting_ended", actualJoinedAt: joined, admissionWaitSeconds: 2.5, metrics: { worker_rss_bytes: 1024 }, ffmpegExitCode: 0 };
    },
  };
  const validator = { async validate(path) { return { durationSeconds: 12.5, bytes: (await stat(path)).size, videoCodec: "h264", audioCodec: "aac", width: 1280, height: 720, audioMeanVolumeDb: -24.2 }; } };
  const outcome = await processNextRecorderJob(deps(runtime, validator));
  assert.equal(outcome.status, "completed");

  const detail = await repository().getDetail({ tenantId: queued.tenantId, workspaceId: queued.workspaceId, meetingId: queued.meeting.id });
  assert.equal(detail.status, "processing");
  assert.equal(detail.recordings.length, 1);
  assert.deepEqual([detail.recordings[0].videoCodec, detail.recordings[0].audioCodec, detail.recordings[0].width, detail.recordings[0].height], ["h264", "aac", 1280, 720]);
  assert.deepEqual(await readFile(join(storageDir, detail.recordings[0].storageKey)), Buffer.from("real-recorder-contract-file"));
  await assert.rejects(stat(producedPath), /ENOENT/, "temporario removido depois do upload");
  const transcription = await db.pool.query(`select status from meeting_jobs where meeting_id = $1 and kind = 'transcribe'`, [queued.meeting.id]);
  assert.equal(transcription.rows[0].status, "queued");
  const run = (await db.pool.query(`select * from meeting_recorder_runs where meeting_id = $1`, [queued.meeting.id])).rows[0];
  assert.deepEqual([run.state, run.browser_pid, run.ffmpeg_pid, run.virtual_display, run.audio_sink], ["completed", 111, 222, ":141", "sink_141"]);
  const bot = (await repository().listRecorderBots()).find((item) => item.id === queued.botId);
  assert.deepEqual([bot.status, bot.currentMeetingId], ["active", undefined]);
});

test("CANCEL: antes da admissao cancela job/reuniao e libera bot saudavel", async () => {
  const queued = await queuedRecording("cancel");
  await repository().requestRecordingStop({ tenantId: queued.tenantId, workspaceId: queued.workspaceId, meetingId: queued.meeting.id, actorUserId: "owner-1" });
  const runtime = { async capture(input) { if (await input.shouldStop()) throw new RecorderFailure("CANCELLED", "cancelado antes da admissao"); throw new Error("expected stop"); } };
  const outcome = await processNextRecorderJob(deps(runtime, { async validate() { throw new Error("not called"); } }));
  assert.equal(outcome.failureCode, "CANCELLED");
  const detail = await repository().getDetail({ tenantId: queued.tenantId, workspaceId: queued.workspaceId, meetingId: queued.meeting.id });
  assert.equal(detail.status, "cancelled");
  const job = (await db.pool.query(`select status from meeting_jobs where id = $1`, [queued.jobId])).rows[0];
  assert.equal(job.status, "cancelled");
  const bot = (await repository().listRecorderBots()).find((item) => item.id === queued.botId);
  assert.equal(bot.status, "active");
});

test("BOT SESSION INVALID: falha normalizada e bot sai do pool", async () => {
  const queued = await queuedRecording("invalid-session", "nao-e-um-ciphertext");
  const outcome = await processNextRecorderJob(deps({ async capture() { throw new Error("not called"); } }, { async validate() { throw new Error("not called"); } }));
  assert.deepEqual([outcome.status, outcome.failureCode], ["failed", "BOT_SESSION_INVALID"]);
  const bot = (await repository().listRecorderBots()).find((item) => item.id === queued.botId);
  assert.equal(bot.status, "invalid_session");
});

test("ORPHAN RECOVERY: heartbeat vencido falha run/job e libera bot", async () => {
  const queued = await queuedRecording("orphan");
  const repo = repository();
  const job = await repo.claimJob({ kinds: ["record"], workerId: "dead-worker", leaseMs: 1000 });
  await repo.createRecorderRun({ id: nextId("mrun"), tenantId: queued.tenantId, workspaceId: queued.workspaceId, meetingId: queued.meeting.id, recordingId: nextId("mrec"), jobId: job.id, botAccountId: queued.botId, workerId: "dead-worker", state: "starting", metrics: {} });
  await db.pool.query(`update meeting_recorder_runs set heartbeat_at = now() - interval '10 minutes' where job_id = $1`, [job.id]);
  const recovered = await recoverOrphanRecorders({ repository: repo, now: () => new Date() }, 60_000);
  assert.equal(recovered, 1);
  const run = (await db.pool.query(`select state, error_code from meeting_recorder_runs where job_id = $1`, [job.id])).rows[0];
  assert.deepEqual([run.state, run.error_code], ["failed", "RECORDER_INTERRUPTED"]);
  assert.equal((await repo.listRecorderBots()).find((item) => item.id === queued.botId).status, "error");
});

test("AUTO RECORD: sem bot repete dentro da grace window e falha depois dela", async () => {
  await db.pool.query(`update recorder_bot_accounts set status = 'disabled' where status <> 'busy'`);
  const scope = await account("auto-retry");
  const repo = repository();
  const now = new Date();
  const meeting = await repo.create({ id: nextId("meeting"), tenantId: scope.tenantId, workspaceId: scope.workspaceId, ownerUserId: "owner-1", createdByUserId: "owner-1", title: "Auto", source: "calendar", status: "scheduled", meetingUrl: "https://meet.google.com/abc-defg-hij", scheduledStartAt: new Date(now.getTime() - 60_000).toISOString(), timezone: "America/Sao_Paulo", autoRecord: true, joinGraceMinutes: 5, participants: [] });
  const input = { defaults: { joinBeforeMinutes: 2, joinGraceMinutes: 5 }, realRecordingEnabled: true, limitsFor: async () => ({ maxConcurrentRecordings: 1, monthlyRecordingMinutes: 600, meetingRetentionDays: 90, maxStorageBytes: 1_000_000 }), limit: 10 };
  const retry = await evaluateAutoRecordings({ repository: repo, now: () => now }, input);
  assert.equal(retry.outcomes.NO_BOT_AVAILABLE_RETRYING, 1);
  assert.equal((await repo.getDetail({ ...scope, meetingId: meeting.id })).status, "scheduled");
  const expired = await evaluateAutoRecordings({ repository: repo, now: () => new Date(now.getTime() + 10 * 60_000) }, input);
  assert.equal(expired.outcomes.NO_BOT_AVAILABLE, 1);
  const detail = await repo.getDetail({ ...scope, meetingId: meeting.id });
  assert.deepEqual([detail.status, detail.failureCode, detail.autoRecordOutcome], ["failed", "NO_BOT_AVAILABLE", "NO_BOT_AVAILABLE"]);
});

test("RBAC/ISOLATION USE CASE: stop so existe no tenant/workspace visivel", async () => {
  const queued = await queuedRecording("stop-scope");
  const useCaseDeps = { repository: repository(), media: media(), limitsFor: async () => ({ maxConcurrentRecordings: 1, monthlyRecordingMinutes: 1, meetingRetentionDays: 1, maxStorageBytes: 1 }), features: { realRecordingEnabled: true }, idGenerator: nextId, now: () => new Date() };
  await assert.rejects(stopMeetingRecording(useCaseDeps, { tenantId: "outro", userId: "owner-1", role: "owner" }, { workspaceId: queued.workspaceId, meetingId: queued.meeting.id }), /MEETING_NOT_FOUND/);
  assert.deepEqual(await stopMeetingRecording(useCaseDeps, { tenantId: queued.tenantId, userId: "owner-1", role: "owner" }, { workspaceId: queued.workspaceId, meetingId: queued.meeting.id }), { stopRequested: true });
});
