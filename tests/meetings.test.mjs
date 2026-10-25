import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresSolutionEntitlementRepository } from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMeetingRepository } from "../dist/infrastructure/storage/postgres/postgres-meeting-repository.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";
import { ObjectStorageMeetingMedia } from "../dist/infrastructure/meetings/object-storage-meeting-media.js";
import { SolutionAccessService } from "../dist/application/solutions/solution-access.service.js";
import { limitsFromEntitlement } from "../dist/application/meetings/meeting-use-cases.js";
import {
  canTransitionMeeting,
  isSupportedMeetingUpload,
  parseGoogleMeetUrl,
  resolveMeetingsLimits,
  DEFAULT_MEETINGS_LIMITS,
} from "../dist/domain/meetings/meeting.model.js";
import { configureObjectUrlSigning, deriveObjectUrlSigningKey, parseOwnedObjectUrl, verifyObjectSignature } from "../dist/shared/utils/object-url-signing.js";
import { parseSingleRange } from "../dist/interfaces/api/routes/uploads.route.js";
import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Vorix Meetings — Fase 1/2 (reunião first-class, Central, upload, admissão de gravação), com
 * banco real (PGlite) e a API Fastify real. O isolamento é verificado na API, não na sidebar.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
const PUBLIC_BASE = "http://localhost:3000/uploads";

let db;
let storageDir;
let counter = 0;
const nextId = (prefix) => `${prefix}-t${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55762 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
  storageDir = await mkdtemp(join(tmpdir(), "vorix-meetings-test-"));
  configureObjectUrlSigning({ publicBaseUrl: PUBLIC_BASE, signingKey: deriveObjectUrlSigningKey("segredo-de-teste") });
});
after(async () => {
  await db.stop();
  await rm(storageDir, { recursive: true, force: true });
});

const solutions = () => new SolutionAccessService({ repository: new PostgresSolutionEntitlementRepository(db.pool), cacheTtlMs: 0 });
const workspaces = () => new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("ws") });

async function grantMeetings(tenantId, limits) {
  await solutions().setEntitlement({ tenantId, solutionKey: "meetings", enabled: true, source: "internal", reason: "teste", ...(limits ? { limits } : {}) });
}

/** Token de teste: `tenant|role|user`. */
const authPort = {
  async verifyToken(token) {
    if (!token) return { authenticated: false, reason: "missing_token" };
    const [tenantId, role, userId] = token.split("|");
    return { authenticated: true, principal: { tenantId, role, userId, sessionId: "s1", isPlatformAdmin: false } };
  },
};

async function buildTestApp({ realRecordingEnabled = false, maxUploadBytes = 2 * 1024 * 1024 } = {}) {
  const config = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" });
  const service = solutions();
  const meetings = {
    repository: new PostgresMeetingRepository(db.pool),
    media: new ObjectStorageMeetingMedia(new LocalObjectStorage({ rootDir: storageDir, publicBaseUrl: PUBLIC_BASE })),
    limitsFor: async (tenantId) => limitsFromEntitlement((await service.getEntitlement(tenantId, "meetings"))?.limits),
    features: { realRecordingEnabled },
    idGenerator: nextId,
    now: () => new Date(),
    maxUploadBytes,
  };
  return buildApp({ config, container: { authPort, solutionAccess: service, meetings, workspaceRepository: workspaces() } });
}

const auth = (tenantId, role = "owner", userId = `user-${tenantId}`) => ({ authorization: `Bearer ${tenantId}|${role}|${userId}` });

async function setupTenant(label, limits) {
  const tenantId = `tenant-meet-${label}`;
  await grantMeetings(tenantId, limits);
  const workspace = await workspaces().create({ tenantId, name: `WS ${label}` });
  return { tenantId, workspaceId: workspace.id };
}

function multipart(boundary, fields, file) {
  const parts = Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  if (file) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

async function upload(app, { tenantId, workspaceId, role = "owner", userId, name = "reuniao.mp3", type = "audio/mpeg", data = Buffer.from("ID3-audio-de-teste"), title }) {
  const boundary = "----vorixmeetings";
  return app.inject({
    method: "POST",
    url: "/v1/meetings/uploads",
    headers: { ...auth(tenantId, role, userId), "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: multipart(boundary, { workspaceId, ...(title ? { title } : {}) }, { name, type, data }),
  });
}

// --- Modelo -----------------------------------------------------------------------------------

test("MODELO: estado terminal protegido, link do Meet, formatos e limites comerciais", () => {
  assert.equal(canTransitionMeeting("completed", "processing"), false, "concluída nunca é rebaixada");
  assert.equal(canTransitionMeeting("cancelled", "recording"), false);
  assert.equal(canTransitionMeeting("recording", "processing"), true);
  assert.equal(parseGoogleMeetUrl("https://meet.google.com/abc-defg-hij?authuser=1"), "https://meet.google.com/abc-defg-hij");
  for (const bad of ["http://meet.google.com/abc-defg-hij", "https://evil.com/abc-defg-hij", "https://meet.google.com/x", "https://user:pw@meet.google.com/abc-defg-hij", "javascript:alert(1)"]) {
    assert.equal(parseGoogleMeetUrl(bad), undefined, bad);
  }
  assert.equal(isSupportedMeetingUpload("audio/mpeg", "a.mp3"), true);
  assert.equal(isSupportedMeetingUpload("video/mp4", "a.mp4"), true);
  assert.equal(isSupportedMeetingUpload("audio/mpeg", "a.exe"), false, "extensão precisa casar com o tipo");
  assert.equal(isSupportedMeetingUpload("application/pdf", "a.pdf"), false);
  assert.deepEqual(resolveMeetingsLimits(undefined), DEFAULT_MEETINGS_LIMITS);
  assert.equal(resolveMeetingsLimits({ maxConcurrentRecordings: 3, meetingRetentionDays: -1 }).maxConcurrentRecordings, 3);
  assert.equal(resolveMeetingsLimits({ meetingRetentionDays: -1 }).meetingRetentionDays, DEFAULT_MEETINGS_LIMITS.meetingRetentionDays, "valor inválido cai no default");
});

test("PLAYER: Range de um intervalo para navegar na gravação", () => {
  assert.deepEqual(parseSingleRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseSingleRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseSingleRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.equal(parseSingleRange("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseSingleRange("bytes=0-1,5-9", 1000), undefined, "múltiplos intervalos = arquivo inteiro");
  assert.equal(parseSingleRange(undefined, 1000), undefined);
});

test("MIGRATION: aditiva — limites no entitlement e custo da análise no catálogo central de créditos", async () => {
  const column = await db.pool.query(`select 1 from information_schema.columns where table_name = 'solution_entitlements' and column_name = 'limits'`);
  assert.equal(column.rowCount, 1);
  const operation = await db.pool.query(`select credits_cost, capability, active from ai_operation_types where code = 'meeting_ai_analysis'`);
  assert.equal(operation.rowCount, 1);
  assert.ok(operation.rows[0].credits_cost > 0);
  assert.equal(operation.rows[0].active, true);
});

// --- Entitlement e solução independente -------------------------------------------------------

test("ENTITLEMENT: sem a solução Meetings a API responde 403; com concessão, 200", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-meet-sem";
  const workspace = await workspaces().create({ tenantId, name: "Sem" });
  const denied = await app.inject({ method: "GET", url: `/v1/meetings?workspaceId=${workspace.id}`, headers: auth(tenantId) });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().error.code, "SOLUTION_ACCESS_DENIED");
  assert.equal(denied.json().error.details.solution, "meetings");
  await grantMeetings(tenantId);
  const allowed = await app.inject({ method: "GET", url: `/v1/meetings?workspaceId=${workspace.id}`, headers: auth(tenantId) });
  assert.equal(allowed.statusCode, 200);
  await app.close();
});

test("STANDALONE: conta só com Meetings (Conversas desligado) usa o Meetings e não acessa o Conversas", async () => {
  const app = await buildTestApp();
  const { tenantId, workspaceId } = await setupTenant("standalone");
  await solutions().setEntitlement({ tenantId, solutionKey: "conversations", enabled: false, source: "manual", reason: "cliente só Meetings" });
  const created = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId), payload: { workspaceId, source: "manual", title: "Kickoff" } });
  assert.equal(created.statusCode, 201);
  for (const url of [`/v1/contacts?workspaceId=${workspaceId}`, `/v1/inbox/conversations?workspaceId=${workspaceId}`, `/v1/deals?workspaceId=${workspaceId}`]) {
    const response = await app.inject({ method: "GET", url, headers: auth(tenantId) });
    assert.equal(response.statusCode, 403, url);
    assert.equal(response.json().error.details.solution, "conversations", url);
  }
  const listed = await app.inject({ method: "GET", url: "/v1/solutions", headers: auth(tenantId) });
  assert.deepEqual(listed.json().data.solutions.map((solution) => solution.key), ["meetings"]);
  await app.close();
});

// --- Central de Reuniões ----------------------------------------------------------------------

test("CENTRAL: reunião manual, link avulso e upload aparecem — sem nenhum evento de Agenda", async () => {
  const app = await buildTestApp();
  const { tenantId, workspaceId } = await setupTenant("central");
  const manual = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId), payload: { workspaceId, source: "manual", title: "Reunião de planejamento", participants: [{ name: "Ana" }, { email: "BIA@Cliente.com" }] } });
  assert.equal(manual.statusCode, 201);
  const meeting = manual.json().data.meeting;
  assert.equal(meeting.source, "manual");
  assert.equal(meeting.status, "scheduled");
  assert.equal(meeting.calendarEventId, undefined, "Meeting não exige evento de Agenda");
  assert.deepEqual(meeting.participants.map((p) => p.email ?? p.name), ["Ana", "bia@cliente.com"], "participante só com nome ou e-mail — sem Contato obrigatório");

  const noLink = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId), payload: { workspaceId, source: "external_link" } });
  assert.equal(noLink.statusCode, 400);
  const badLink = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId), payload: { workspaceId, source: "external_link", meetingUrl: "https://zoom.us/j/1" } });
  assert.equal(badLink.statusCode, 400);
  const link = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId), payload: { workspaceId, source: "external_link", meetingUrl: "https://meet.google.com/abc-defg-hij" } });
  assert.equal(link.statusCode, 201);

  const uploaded = await upload(app, { tenantId, workspaceId, title: "Call com cliente" });
  assert.equal(uploaded.statusCode, 201, uploaded.body);

  const list = await app.inject({ method: "GET", url: `/v1/meetings?workspaceId=${workspaceId}`, headers: auth(tenantId) });
  const items = list.json().data.items;
  assert.equal(list.json().data.total, 3);
  assert.deepEqual(new Set(items.map((item) => item.source)), new Set(["manual", "external_link", "upload"]));
  const fromUpload = items.find((item) => item.source === "upload");
  assert.equal(fromUpload.hasRecording, true);
  assert.equal(fromUpload.status, "processing");
  assert.equal(fromUpload.transcriptStatus, "queued", "transcrição enfileirada automaticamente");
  const events = await db.pool.query(`select count(*)::int as n from calendar_events where tenant_id = $1`, [tenantId]);
  assert.equal(events.rows[0].n, 0, "a Central consulta meetings, nunca calendar_events");
  await app.close();
});

test("CENTRAL: filtros por origem, gravação e busca no título E na transcrição", async () => {
  const app = await buildTestApp();
  const { tenantId, workspaceId } = await setupTenant("filtros");
  await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId), payload: { workspaceId, source: "manual", title: "Revisão trimestral" } });
  const uploaded = (await upload(app, { tenantId, workspaceId, title: "Alinhamento comercial" })).json().data;
  // Transcrição segmentada (o worker de transcrição é a Fase 6; aqui o dado é inserido direto).
  const transcript = await db.pool.query(`select id from meeting_transcripts where meeting_id = $1`, [uploaded.id]);
  await db.pool.query(`update meeting_transcripts set status = 'completed', segment_count = 2 where id = $1`, [transcript.rows[0].id]);
  await db.pool.query(
    `insert into meeting_transcript_segments (id, transcript_id, meeting_id, tenant_id, seq, start_ms, end_ms, speaker, text) values
     ('seg-1', $1, $2, $3, 0, 0, 4000, 'Ana', 'vamos fechar o orçamento da campanha'),
     ('seg-2', $1, $2, $3, 1, 4000, 9000, 'Bia', 'combinado, envio a proposta amanhã')`,
    [transcript.rows[0].id, uploaded.id, tenantId],
  );
  const get = async (query) => (await app.inject({ method: "GET", url: `/v1/meetings?workspaceId=${workspaceId}&${query}`, headers: auth(tenantId) })).json().data.items.map((item) => item.title);
  assert.deepEqual(await get("source=upload"), ["Alinhamento comercial"]);
  assert.deepEqual(await get("hasRecording=false"), ["Revisão trimestral"]);
  assert.deepEqual(await get("hasTranscript=true"), ["Alinhamento comercial"]);
  assert.deepEqual(await get("q=trimestral"), ["Revisão trimestral"]);
  assert.deepEqual(await get("q=orçamento"), ["Alinhamento comercial"], "busca encontra conteúdo da transcrição");
  const segments = await app.inject({ method: "GET", url: `/v1/meetings/${uploaded.id}/transcript?workspaceId=${workspaceId}`, headers: auth(tenantId) });
  assert.deepEqual(segments.json().data.segments.map((segment) => [segment.startMs, segment.speaker]), [[0, "Ana"], [4000, "Bia"]]);
  await app.close();
});

// --- Upload e gravação privada ----------------------------------------------------------------

test("UPLOAD: arquivo no storage privado com checksum; reprodução só por URL assinada curta e auditada", async () => {
  const app = await buildTestApp();
  const { tenantId, workspaceId } = await setupTenant("upload");
  const data = Buffer.from("conteudo-de-video-mp4-de-teste");
  const response = await upload(app, { tenantId, workspaceId, name: "call.mp4", type: "video/mp4", data });
  assert.equal(response.statusCode, 201, response.body);
  const meeting = response.json().data;
  const recording = meeting.recordings[0];
  assert.equal(recording.bytes, data.length);
  assert.equal(recording.checksumSha256, createHash("sha256").update(data).digest("hex"));
  assert.equal(recording.mimeType, "video/mp4");
  assert.match(recording.storageKey, new RegExp(`^meetings/${tenantId}/${workspaceId}/${meeting.id}/`));
  assert.deepEqual(await readFile(join(storageDir, recording.storageKey)), data);
  assert.equal(JSON.stringify(meeting).includes("sig="), false, "o detalhe nunca carrega URL de leitura");

  const playback = await app.inject({ method: "GET", url: `/v1/meetings/${meeting.id}/recordings/${recording.id}/playback?workspaceId=${workspaceId}`, headers: auth(tenantId) });
  assert.equal(playback.statusCode, 200);
  const { url, expiresInSeconds } = playback.json().data;
  assert.ok(expiresInSeconds <= 15 * 60);
  const parsed = parseOwnedObjectUrl(url);
  assert.equal(parsed.key, recording.storageKey);
  assert.equal(verifyObjectSignature(parsed.key, parsed.exp, parsed.sig), "VALID");
  assert.equal(verifyObjectSignature(parsed.key, undefined, undefined), "MISSING", "sem assinatura não há leitura");
  const audit = await db.pool.query(`select action from meeting_audit_log where meeting_id = $1 order by created_at`, [meeting.id]);
  assert.deepEqual(audit.rows.map((row) => row.action), ["recording.uploaded", "recording.accessed"]);
  await app.close();
});

test("UPLOAD: formato não suportado (415), acima do limite (413) e sem workspace (400) — nada é gravado", async () => {
  const app = await buildTestApp({ maxUploadBytes: 64 });
  const { tenantId, workspaceId } = await setupTenant("upload-erros");
  const unsupported = await upload(app, { tenantId, workspaceId, name: "doc.pdf", type: "application/pdf" });
  assert.equal(unsupported.statusCode, 415);
  const tooLarge = await upload(app, { tenantId, workspaceId, data: Buffer.alloc(200, 1) });
  assert.equal(tooLarge.statusCode, 413);
  const boundary = "----semws";
  const noWorkspace = await app.inject({ method: "POST", url: "/v1/meetings/uploads", headers: { ...auth(tenantId), "content-type": `multipart/form-data; boundary=${boundary}` }, payload: multipart(boundary, {}, { name: "a.mp3", type: "audio/mpeg", data: Buffer.from("x") }) });
  assert.equal(noWorkspace.statusCode, 400);
  const rows = await db.pool.query(`select count(*)::int as n from meetings where tenant_id = $1`, [tenantId]);
  assert.equal(rows.rows[0].n, 0);
  await app.close();
});

test("UPLOAD: limite de armazenamento do plano é respeitado", async () => {
  const app = await buildTestApp();
  const { tenantId, workspaceId } = await setupTenant("storage", { maxStorageBytes: 30 });
  assert.equal((await upload(app, { tenantId, workspaceId, data: Buffer.alloc(20, 1) })).statusCode, 201);
  const second = await upload(app, { tenantId, workspaceId, data: Buffer.alloc(20, 1) });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, "MEETING_STORAGE_LIMIT_REACHED");
  await app.close();
});

// --- RBAC e isolamento ------------------------------------------------------------------------

test("RBAC: viewer não cria; editor vê só as próprias; admin vê todas; editor não exclui", async () => {
  const app = await buildTestApp();
  const { tenantId, workspaceId } = await setupTenant("rbac");
  const viewerCreate = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId, "viewer", "u-viewer"), payload: { workspaceId, source: "manual" } });
  assert.equal(viewerCreate.statusCode, 403);
  const mine = (await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId, "editor", "u-editor"), payload: { workspaceId, source: "manual", title: "Minha" } })).json().data.meeting;
  const other = (await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId, "admin", "u-admin"), payload: { workspaceId, source: "manual", title: "Da gestão" } })).json().data.meeting;

  const editorList = await app.inject({ method: "GET", url: `/v1/meetings?workspaceId=${workspaceId}`, headers: auth(tenantId, "editor", "u-editor") });
  assert.deepEqual(editorList.json().data.items.map((item) => item.title), ["Minha"]);
  const editorOther = await app.inject({ method: "GET", url: `/v1/meetings/${other.id}?workspaceId=${workspaceId}`, headers: auth(tenantId, "editor", "u-editor") });
  assert.equal(editorOther.statusCode, 404, "fora do escopo = não existe");
  const adminList = await app.inject({ method: "GET", url: `/v1/meetings?workspaceId=${workspaceId}`, headers: auth(tenantId, "admin", "u-admin") });
  assert.equal(adminList.json().data.total, 2);

  const editorDelete = await app.inject({ method: "DELETE", url: `/v1/meetings/${mine.id}?workspaceId=${workspaceId}`, headers: auth(tenantId, "editor", "u-editor") });
  assert.equal(editorDelete.statusCode, 403);
  const adminDelete = await app.inject({ method: "DELETE", url: `/v1/meetings/${mine.id}?workspaceId=${workspaceId}`, headers: auth(tenantId, "admin", "u-admin") });
  assert.equal(adminDelete.statusCode, 200);
  const row = await db.pool.query(`select deleted_at, deleted_by_user_id from meetings where id = $1`, [mine.id]);
  assert.ok(row.rows[0].deleted_at, "soft delete: a linha continua no banco");
  assert.equal(row.rows[0].deleted_by_user_id, "u-admin");
  const after = await app.inject({ method: "GET", url: `/v1/meetings?workspaceId=${workspaceId}`, headers: auth(tenantId, "admin", "u-admin") });
  assert.equal(after.json().data.total, 1);
  await app.close();
});

test("ISOLAMENTO: tenant B não vê, não reproduz, não transcreve e não grava reunião do tenant A", async () => {
  const app = await buildTestApp({ realRecordingEnabled: true });
  const a = await setupTenant("iso-a");
  const b = await setupTenant("iso-b");
  const meeting = (await upload(app, { tenantId: a.tenantId, workspaceId: a.workspaceId })).json().data;
  const recordingId = meeting.recordings[0].id;
  for (const workspaceId of [a.workspaceId, b.workspaceId]) {
    for (const url of [`/v1/meetings/${meeting.id}?workspaceId=${workspaceId}`, `/v1/meetings/${meeting.id}/recordings/${recordingId}/playback?workspaceId=${workspaceId}`, `/v1/meetings/${meeting.id}/transcript?workspaceId=${workspaceId}`]) {
      const response = await app.inject({ method: "GET", url, headers: auth(b.tenantId) });
      assert.equal(response.statusCode, 404, url);
    }
    const record = await app.inject({ method: "POST", url: `/v1/meetings/${meeting.id}/recording`, headers: auth(b.tenantId), payload: { workspaceId } });
    assert.equal(record.statusCode, 404);
  }
  const list = await app.inject({ method: "GET", url: `/v1/meetings?workspaceId=${a.workspaceId}`, headers: auth(b.tenantId) });
  assert.equal(list.statusCode, 404, "foreign workspaces are rejected before querying the collection");
  const create = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(b.tenantId), payload: { workspaceId: a.workspaceId, source: "manual" } });
  assert.equal(create.statusCode, 404, "não cria reunião em workspace alheio");
  await app.close();
});

// --- Gravação: gate de release, pool de bots e concorrência ----------------------------------

test("GRAVAR AGORA: com a gravação real desligada a reunião é criada e o motivo é explícito (nunca finge gravar)", async () => {
  const app = await buildTestApp({ realRecordingEnabled: false });
  const { tenantId, workspaceId } = await setupTenant("gate");
  const response = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId), payload: { workspaceId, source: "instant", meetingUrl: "https://meet.google.com/abc-defg-hij", recordNow: true } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.recording.ok, false);
  assert.equal(response.json().data.recording.reason, "RECORDING_DISABLED");
  assert.equal(response.json().data.meeting.status, "scheduled");
  await app.close();
});

test("CONTAS DE GRAVAÇÃO + CONCORRÊNCIA: limite do plano nunca é excedido, conta nunca é duplicada, sem conta = motivo explícito", async () => {
  const app = await buildTestApp({ realRecordingEnabled: true });
  const { tenantId, workspaceId } = await setupTenant("concorrencia");
  const create = async () => (await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId), payload: { workspaceId, source: "external_link", meetingUrl: "https://meet.google.com/abc-defg-hij", humanJoinAccountEmail: "pessoa@empresa.test" } })).json().data.meeting.id;
  const record = async (meetingId) => (await app.inject({ method: "POST", url: `/v1/meetings/${meetingId}/recording`, headers: auth(tenantId), payload: { workspaceId } })).json().data;

  const m1 = await create();
  const empty = await record(m1);
  assert.equal(empty.reason, "NO_RECORDER_ACCOUNT_AVAILABLE", "nenhuma conta conectada: nada inicia");
  assert.equal(empty.connectedAccounts, 0);

  await db.pool.query(`insert into recorder_bot_accounts (id, ownership_type, tenant_id, workspace_id, label, google_email, encrypted_session_state, status) values ('bot-a', 'customer_managed', $1, $2, 'A', 'bot-a@vorix.test', 'test-session-a', 'active'), ('bot-b', 'customer_managed', $1, $2, 'B', 'bot-b@vorix.test', 'test-session-b', 'active'), ('bot-c', 'customer_managed', $1, $2, 'C', 'bot-c@vorix.test', null, 'disabled')`, [tenantId, workspaceId]);
  const first = await record(m1);
  assert.equal(first.ok, true);
  const m2 = await create();
  const second = await record(m2);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "CONCURRENCY_LIMIT_REACHED", "plano padrão: 1 gravação simultânea");
  assert.equal(second.limit, 1);

  await grantMeetings(tenantId, { maxConcurrentRecordings: 3 });
  const third = await record(m2);
  assert.equal(third.ok, true);
  assert.notEqual(third.botAccountId, first.botAccountId, "bots distintos");
  const m3 = await create();
  const fourth = await record(m3);
  assert.equal(fourth.reason, "NO_RECORDER_ACCOUNT_AVAILABLE", "conta desabilitada nunca é usada; as saudáveis estão ocupadas");
  assert.equal((await record(m1)).reason, "INVALID_STATE", "reunião já na fila não é admitida de novo");

  const bots = await db.pool.query(`select id, status, current_meeting_id from recorder_bot_accounts where tenant_id = $1 order by id`, [tenantId]);
  assert.deepEqual(bots.rows.map((row) => [row.id, row.status]), [["bot-a", "busy"], ["bot-b", "busy"], ["bot-c", "disabled"]]);
  assert.equal(new Set(bots.rows.filter((row) => row.current_meeting_id).map((row) => row.current_meeting_id)).size, 2);
  const jobs = await db.pool.query(`select count(*)::int as n from meeting_jobs where tenant_id = $1 and kind = 'record' and status = 'queued'`, [tenantId]);
  assert.equal(jobs.rows[0].n, 2);
  const refused = await db.pool.query(`select count(*)::int as n from meeting_audit_log where tenant_id = $1 and action = 'recording.refused' and details->>'reason' = 'CONCURRENCY_LIMIT_REACHED'`, [tenantId]);
  assert.equal(refused.rows[0].n, 1, "limite atingido fica registrado");
  const usage = await db.pool.query(`select concurrent_peak from meeting_usage_monthly where tenant_id = $1`, [tenantId]);
  assert.equal(usage.rows[0].concurrent_peak, 2);

  const deleteActive = await app.inject({ method: "DELETE", url: `/v1/meetings/${m1}?workspaceId=${workspaceId}`, headers: auth(tenantId) });
  assert.equal(deleteActive.statusCode, 409, "reunião com bot ativo não é excluída");

  const repository = new PostgresMeetingRepository(db.pool);
  await repository.releaseBot({ meetingId: m1, healthy: true });
  await repository.releaseBot({ meetingId: m2, healthy: false });
  const released = await db.pool.query(`select id, status, current_meeting_id, consecutive_failures from recorder_bot_accounts where id in ('bot-a', 'bot-b') order by id`);
  assert.ok(released.rows.every((row) => row.current_meeting_id === null));
  assert.deepEqual(released.rows.map((row) => row.status).sort(), ["active", "error"], "bot com falha sai do rodízio");
  await db.pool.query(`delete from recorder_bot_accounts`);
  await app.close();
});

test("DASHBOARD: contadores da home do Meetings", async () => {
  const app = await buildTestApp();
  const { tenantId, workspaceId } = await setupTenant("dashboard");
  await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(tenantId), payload: { workspaceId, source: "manual", scheduledStartAt: new Date().toISOString() } });
  await upload(app, { tenantId, workspaceId });
  const response = await app.inject({ method: "GET", url: `/v1/meetings/dashboard?workspaceId=${workspaceId}`, headers: auth(tenantId) });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.meetingsToday, 2);
  assert.equal(data.processing, 1);
  assert.equal(data.recordingNow, 0);
  assert.equal(data.limits.maxConcurrentRecordings, 1);
  assert.equal(data.realRecordingEnabled, false);
  await app.close();
});
